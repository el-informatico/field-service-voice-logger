#!/usr/bin/env node
// noise-mix.mjs — mix each TTS turn with each DEMAND noise scenario at fixed
// SNR for the D2 gate / D4 WER clean-vs-noisy measurement.
//
//   node scripts/noise-mix.mjs                       # all guiones x noises x SNR {10,5,0}
//   node scripts/noise-mix.mjs --snrs 10 --guiones s1-happy-path
//   node scripts/noise-mix.mjs --snrs 10 --noises DKITCHEN --turns 1,3,5
//
// Output: .data/noisy/<guion>/<noise>/<snr>db/turn-<n>.wav + manifest.json
// per directory, plus .data/noisy/manifest.json (index).
//
// Method (offline mix, SNR on RMS):
//   1. Trim leading/trailing silence from the speech (cached once per turn in
//      .data/noisy/.work/<guion>/) so speech RMS is measured on active speech.
//   2. Measure RMS/peak of trimmed speech and of the noise SEGMENT
//      (deterministic offset per turn x noise, reused across SNRs).
//   3. Noise gain = speechRMS - SNR - noiseRMS (dB); speech stays at unity.
//      Both gains are scaled by a common factor if the estimated summed peak
//      would clip (SNR unchanged, headroom kept).
//   4. Render once (amix normalize=0), then validate on the rendered file:
//      achieved SNR = 10log10((P_mix - P_noise_branch)/P_noise_branch).
//      |achieved - target| > 1.5 dB -> warn in manifest.
//
// Env: FFMPEG (default ffmpeg), TTS_DIR / NOISE_DIR / NOISY_DIR overrides.
// Zero npm deps, ESM, Node >= 22. DEV-ONLY material (see tts-synth.mjs).

import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const FFMPEG = process.env.FFMPEG || 'ffmpeg';
const TTS_DIR = process.env.TTS_DIR || join(ROOT, '.data', 'tts');
const NOISE_DIR = process.env.NOISE_DIR || join(ROOT, '.data', 'noise');
const OUT_DIR = process.env.NOISY_DIR || join(ROOT, '.data', 'noisy');

const SNR_TOLERANCE_DB = 1.5;
const PEAK_CEILING = 0.97; // linear ceiling for estimated summed peak
const TRIM_THRESHOLD_DB = -40;
const TRIM_KEEP_S = 0.15;

function parseArgs(argv) {
  const o = { snrs: [10, 5, 0], guiones: null, noises: null, turns: null, force: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--snrs') { i++; o.snrs = argv[i].split(',').map(Number); }
    else if (a === '--guiones') { i++; o.guiones = argv[i].split(',').filter(Boolean); }
    else if (a === '--noises') { i++; o.noises = argv[i].split(',').filter(Boolean); }
    else if (a === '--turns') { i++; o.turns = argv[i].split(',').map(Number); }
    else if (a === '--force') o.force = true;
    else throw new Error(`Unknown arg: ${a}`);
  }
  return o;
}

function run(cmd, args, { timeoutMs = 120000 } = {}) {
  return new Promise((ok, no) => {
    const p = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    const t = setTimeout(() => p.kill('SIGKILL'), timeoutMs);
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { err += d; });
    p.on('error', (e) => { clearTimeout(t); no(e); });
    p.on('close', (code) => {
      clearTimeout(t);
      if (code === 0) ok({ out, err });
      else no(new Error(`${cmd} exited ${code}\n${err.slice(0, 2000)}`));
    });
  });
}

const dB2lin = (db) => 10 ** (db / 20);
const lin2dB = (lin) => 20 * Math.log10(Math.max(lin, 1e-12));

/** volumedetect: { rmsDb, peakDb } (RMS = mean_volume, peak = max_volume). */
async function analyze(file, extraFilters = []) {
  const af = [...extraFilters, 'volumedetect'].join(',');
  const { err } = await run(FFMPEG, ['-hide_banner', '-i', file, '-af', af, '-f', 'null', '-']);
  const rms = Number.parseFloat(err.match(/mean_volume:\s*(-?[\d.]+)/)?.[1]);
  const peak = Number.parseFloat(err.match(/max_volume:\s*(-?[\d.]+)/)?.[1]);
  if (!Number.isFinite(rms) || !Number.isFinite(peak)) {
    throw new Error(`volumedetect failed for ${file} (filters: ${af})`);
  }
  return { rmsDb: rms, peakDb: peak };
}

/** ffmpeg -i duration probe via stderr "Duration: HH:MM:SS.ms". */
async function probeDuration(file) {
  const { err } = await run(FFMPEG, ['-hide_banner', '-i', file, '-f', 'null', '-']);
  const m = err.match(/Duration:\s*(\d+):(\d+):(\d+)\.(\d+)/);
  if (!m) throw new Error(`no Duration line for ${file}`);
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) + Number(`0.${m[4]}`);
}

/** Trim leading/trailing silence once; cached. */
async function trimmedSpeech(wav, cacheFile, force) {
  if (existsSync(cacheFile) && !force) return cacheFile;
  const trim = `silenceremove=start_periods=1:start_threshold=${TRIM_THRESHOLD_DB}dB:start_silence=${TRIM_KEEP_S}`;
  const af = `${trim},areverse,${trim},areverse`;
  await run(FFMPEG, ['-y', '-loglevel', 'error', '-i', wav, '-af', af,
    '-ar', '24000', '-ac', '1', '-c:a', 'pcm_s16le', cacheFile]);
  return cacheFile;
}

/** Deterministic offset in [0, maxOffset] from a stable key. */
function stableOffset(key, maxOffset) {
  if (maxOffset <= 0) return 0;
  const h = createHash('sha1').update(key).digest();
  const frac = h.readUInt32BE(0) / 0xffffffff;
  return Math.round(frac * maxOffset * 100) / 100;
}

function discoverTts(filter) {
  const out = [];
  for (const scen of readdirSync(TTS_DIR).sort()) {
    if (filter.guiones && !filter.guiones.some((g) => scen.includes(g))) continue;
    const dir = join(TTS_DIR, scen);
    if (!statSync(dir).isDirectory() || scen.startsWith('.')) continue;
    const manifest = existsSync(join(dir, 'manifest.json'))
      ? JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')) : null;
    for (const f of readdirSync(dir).sort()) {
      const m = f.match(/^turn-(\d+)(-as-heard)?\.wav$/);
      if (!m) continue;
      const n = Number(m[1]);
      if (filter.turns && !filter.turns.includes(n)) continue;
      const entry = manifest?.turns?.find((t) => t.file === f || t.file === `${scen}/${f}`);
      out.push({
        guion: scen, n, variant: m[2] ? 'as_heard' : null,
        file: join(dir, f), relFile: f, text: entry?.text ?? null,
      });
    }
  }
  return out;
}

function discoverNoise(filter) {
  const out = [];
  if (!existsSync(NOISE_DIR)) return out;
  for (const scen of readdirSync(NOISE_DIR).sort()) {
    if (filter.noises && !filter.noises.some((x) => scen.includes(x))) continue;
    const dir = join(NOISE_DIR, scen);
    if (!statSync(dir).isDirectory() || scen.startsWith('.')) continue;
    for (const f of ['noise-24k.wav', 'noise-24k-PLACEHOLDER.wav']) {
      const p = join(dir, f);
      if (existsSync(p)) {
        const src = existsSync(join(dir, 'source.json'))
          ? JSON.parse(readFileSync(join(dir, 'source.json'), 'utf8')) : {};
        out.push({
          noise: scen, file: p, placeholder: Boolean(src.placeholder),
          source: src.dataset ?? src.placeholder_kind ?? 'unknown',
        });
        break;
      }
    }
  }
  return out;
}

async function mixOne({ speechTrim, entry, noise, snr, outWav }) {
  const speech = await analyze(speechTrim);
  const speechDur = await probeDuration(speechTrim);
  const noiseDur = await probeDuration(noise.file);
  if (speechDur >= noiseDur) throw new Error(`noise ${noise.file} shorter than speech (${noiseDur}s < ${speechDur}s)`);

  // Same noise segment for a given (turn, noise) across SNRs: controlled variable.
  const offset = stableOffset(`${entry.guion}|${entry.relFile}|${noise.noise}`, noiseDur - speechDur - 0.5);
  const segFilters = `atrim=start=${offset}:duration=${speechDur.toFixed(3)},asetpts=PTS-STARTPTS`;
  const noiseSeg = await analyze(noise.file, [segFilters]);

  // Gains: speech at unity; noise placed SNR below it. Common-factor clip guard.
  const gnDb = speech.rmsDb - snr - noiseSeg.rmsDb;
  let gsLin = 1;
  let gnLin = dB2lin(gnDb);
  const estPeak = gsLin * dB2lin(speech.peakDb) + gnLin * dB2lin(noiseSeg.peakDb);
  if (estPeak > PEAK_CEILING) {
    const k = PEAK_CEILING / estPeak;
    gsLin *= k;
    gnLin *= k;
  }
  const gsDb = lin2dB(gsLin);
  const gnDbFinal = lin2dB(gnLin);

  const fc = [
    `[0:a]volume=${gsDb.toFixed(3)}dB[s]`,
    `[1:a]${segFilters},volume=${gnDbFinal.toFixed(3)}dB[n]`,
    '[s][n]amix=inputs=2:duration=first:normalize=0[out]',
  ].join(';');
  await run(FFMPEG, ['-y', '-loglevel', 'error',
    '-i', speechTrim, '-i', noise.file,
    '-filter_complex', fc, '-map', '[out]',
    '-ar', '24000', '-ac', '1', '-c:a', 'pcm_s16le', outWav]);

  // Post-mix validation on the RENDERED files (energy additivity).
  const mixed = await analyze(outWav);
  const noiseBranch = await analyze(noise.file, [segFilters, `volume=${gnDbFinal.toFixed(3)}dB`]);
  const pMix = dB2lin(mixed.rmsDb) ** 2;
  const pNoise = dB2lin(noiseBranch.rmsDb) ** 2;
  const pSpeech = Math.max(pMix - pNoise, 1e-12);
  const achieved = 10 * Math.log10(pSpeech / pNoise);
  const warn = Math.abs(achieved - snr) > SNR_TOLERANCE_DB;

  return {
    input: `${entry.guion}/${entry.relFile}`,
    variant: entry.variant,
    n: entry.n,
    text: entry.text,
    noise: `${noise.noise}/noise-24k${noise.placeholder ? '-PLACEHOLDER' : ''}.wav`,
    placeholder_noise: noise.placeholder,
    noise_offset_s: offset,
    duration_s: Number(speechDur.toFixed(3)),
    snr_requested_db: snr,
    snr_achieved_db: Number(achieved.toFixed(2)),
    peak_dbfs: mixed.peakDb,
    speech_rms_dbfs: Number(speech.rmsDb.toFixed(2)),
    noise_rms_dbfs: Number(noiseBranch.rmsDb.toFixed(2)),
    gains_db: { speech: Number(gsDb.toFixed(2)), noise: Number(gnDbFinal.toFixed(2)) },
    warn,
  };
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const tts = discoverTts(opts);
  const noises = discoverNoise(opts);
  if (!tts.length) throw new Error(`no TTS wavs under ${TTS_DIR} — run scripts/tts-synth.mjs first`);
  if (!noises.length) throw new Error(`no noise under ${NOISE_DIR} — run scripts/fetch-noise.sh first`);
  console.log(`[noise-mix] ${tts.length} speech files x ${noises.length} noises x ${opts.snrs.length} SNRs = ${tts.length * noises.length * opts.snrs.length} mixes`);

  const workRoot = join(OUT_DIR, '.work');
  mkdirSync(workRoot, { recursive: true });

  const index = [];
  let nWarn = 0;
  for (const noise of noises) {
    for (const snr of opts.snrs) {
      const byGuion = new Map(); // guion -> { dir, entries: [] }
      for (const entry of tts) {
        const dir = join(OUT_DIR, entry.guion, noise.noise, `${snr}db`);
        mkdirSync(dir, { recursive: true });
        const bucket = byGuion.get(entry.guion) ?? { dir, entries: [] };
        byGuion.set(entry.guion, bucket);
        const outWav = join(dir, entry.relFile);
        if (!opts.force && existsSync(outWav)) {
          // Previously rendered: carry its manifest record over instead of re-rendering.
          const prevPath = join(dir, 'manifest.json');
          if (existsSync(prevPath)) {
            const prevRec = JSON.parse(readFileSync(prevPath, 'utf8'))
              .entries?.find((e) => e.input === `${entry.guion}/${entry.relFile}`);
            if (prevRec) { bucket.entries.push(prevRec); if (prevRec.warn) nWarn++; continue; }
          }
        }
        const cache = join(workRoot, entry.guion, entry.relFile);
        mkdirSync(dirname(cache), { recursive: true });
        const speechTrim = await trimmedSpeech(entry.file, cache, opts.force);
        const rec = await mixOne({ speechTrim, entry, noise, snr, outWav });
        if (rec.warn) nWarn++;
        console.log(`  ${rec.input} + ${noise.noise} @${snr}dB -> achieved ${rec.snr_achieved_db}dB peak ${rec.peak_dbfs}dB${rec.warn ? '  [WARN >1.5dB]' : ''}`);
        bucket.entries.push(rec);
      }

      // Manifest per <guion>/<noise>/<snr>db (only when it has records).
      for (const [guion, { dir, entries }] of byGuion) {
        if (!entries.length) continue;
        const manifest = {
          guion, noise: noise.noise, noise_placeholder: noise.placeholder,
          noise_source: noise.source, snr_requested_db: snr,
          tolerance_db: SNR_TOLERANCE_DB,
          method: 'RMS-based offline mix; achieved SNR re-measured post-mix via power subtraction',
          entries,
        };
        writeFileSync(join(dir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
        index.push({
          guion, noise: noise.noise, snr_db: snr, dir: dir.slice(OUT_DIR.length + 1),
          files: entries.length,
          warn_count: entries.filter((e) => e.warn).length,
          mean_abs_dev_db: Number((entries.reduce((a, e) => a + Math.abs(e.snr_achieved_db - snr), 0) / entries.length).toFixed(3)),
        });
      }
    }
  }

  writeFileSync(join(OUT_DIR, 'manifest.json'), `${JSON.stringify({
    generated_for: 'D2 gate / D4 WER clean-vs-noisy',
    tts_dir: TTS_DIR, noise_dir: NOISE_DIR, snrs: opts.snrs, combos: index,
  }, null, 2)}\n`);
  console.log(`[noise-mix] DONE: ${index.length} (guion x noise x snr) combos, ${nWarn} entries with |dev| > ${SNR_TOLERANCE_DB} dB -> ${OUT_DIR}`);
}

main().catch((e) => { console.error(`[noise-mix] FATAL: ${e.message}`); process.exit(1); });

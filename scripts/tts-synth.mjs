#!/usr/bin/env node
// tts-synth.mjs — synthesize every USER turn of the 3 guiones to wav
// (24 kHz mono PCM16), the exact session audio format.
//
//   node scripts/tts-synth.mjs [--guiones s1-happy-path,s2-pieza-mal-oida] \
//       [--turn 5] [--force]
//
// Output: .data/tts/<scenario>/turn-<n>.wav  (+ turn-<n>-as-heard.wav when the
// guion turn carries an `as_heard` variant, e.g. s2 turn 5) and a per-scenario
// manifest.json (file, text, duration).
//
// Env (no paths are hard-coded; defaults resolve from $PATH / repo layout):
//   EDGE_TTS    path to the edge-tts binary        (default: edge-tts)
//   FFMPEG      path to ffmpeg                     (default: ffmpeg)
//   FFPROBE     path to ffprobe                    (default: ffprobe)
//   TTS_VOICE   voice name                         (default: es-MX-JorgeNeural)
//   TTS_RATE    optional rate argument, e.g. "+0%" (default: unset)
//
// DEV-ONLY material: synthesized speech is test input for the D2/D4 noise
// harness; it must never appear in the demo video or published artifacts.
// Zero npm deps, ESM, Node >= 22.

import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const EDGE_TTS = process.env.EDGE_TTS || 'edge-tts';
const FFMPEG = process.env.FFMPEG || 'ffmpeg';
const FFPROBE = process.env.FFPROBE || 'ffprobe';
const VOICE = process.env.TTS_VOICE || 'es-MX-JorgeNeural';
const RATE = process.env.TTS_RATE || '';
const OUT_ROOT = process.env.TTS_DIR || join(ROOT, '.data', 'tts');

const SAMPLE_RATE = 24000;

function parseArgs(argv) {
  const o = { guiones: null, turn: null, force: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--guiones') { i++; o.guiones = argv[i].split(',').filter(Boolean); }
    else if (a === '--turn') { i++; o.turn = Number.parseInt(argv[i], 10); }
    else if (a === '--force') o.force = true;
    else throw new Error(`Unknown arg: ${a}`);
  }
  return o;
}

/** Run a command; capture stdout. Rejects on non-zero exit. */
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
      if (code === 0) ok(out);
      else no(new Error(`${cmd} exited ${code}\n${err.slice(0, 2000)}`));
    });
  });
}

async function retry(fn, label, attempts = 3) {
  let lastErr;
  for (let i = 1; i <= attempts; i++) {
    try { return await fn(); } catch (e) {
      lastErr = e;
      console.warn(`[tts-synth] retry ${i}/${attempts} ${label}: ${e.message.split('\n')[0]}`);
      await new Promise((r) => setTimeout(r, 1500 * i));
    }
  }
  throw lastErr;
}

/** Media duration in seconds via ffprobe. */
async function probeDuration(file) {
  const out = await run(FFPROBE, [
    '-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', file,
  ]);
  const d = Number.parseFloat(out.trim());
  if (!Number.isFinite(d)) throw new Error(`ffprobe: no duration for ${file}`);
  return d;
}

/** Synthesize one text -> wav (24 kHz mono PCM16). Returns { file, duration_s, bytes }. */
async function synthTurn({ text, outWav, tmpMp3, label }) {
  await retry(async () => {
    if (existsSync(tmpMp3)) rmSync(tmpMp3);
    const args = ['--voice', VOICE, '--text', text, '--write-media', tmpMp3];
    if (RATE) args.push('--rate', RATE);
    await run(EDGE_TTS, args);
    if (!existsSync(tmpMp3) || statSync(tmpMp3).size < 512) {
      throw new Error('edge-tts produced no output');
    }
  }, label);
  await retry(() => run(FFMPEG, [
    '-y', '-loglevel', 'error', '-i', tmpMp3,
    '-ar', String(SAMPLE_RATE), '-ac', '1', '-c:a', 'pcm_s16le', outWav,
  ]), `${label} (ffmpeg)`);
  rmSync(tmpMp3, { force: true });
  const duration_s = await probeDuration(outWav);
  return { file: outWav, duration_s, bytes: statSync(outWav).size };
}

/** Small concurrency pool that preserves result order. */
async function pool(items, n, worker) {
  const results = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: n }, async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await worker(items[i], i);
    }
  }));
  return results;
}

async function synthScenario(guionFile, opts) {
  const guion = JSON.parse(readFileSync(guionFile, 'utf8'));
  const scenario = guion.scenario_id;
  const outDir = join(OUT_ROOT, scenario);
  mkdirSync(outDir, { recursive: true });
  const tmpDir = join(OUT_ROOT, '.tmp');
  mkdirSync(tmpDir, { recursive: true });

  // Every user turn, plus the as_heard variant when present.
  const jobs = [];
  for (const t of guion.turns.filter((t) => t.role === 'user')) {
    const pad = String(t.n).padStart(2, '0');
    if (opts.turn != null && t.n !== opts.turn) continue;
    jobs.push({
      n: t.n, variant: null, text: t.text,
      outWav: join(outDir, `turn-${pad}.wav`),
      label: `${scenario} t${t.n}`,
    });
    if (t.as_heard) {
      jobs.push({
        n: t.n, variant: 'as_heard', text: t.as_heard,
        outWav: join(outDir, `turn-${pad}-as-heard.wav`),
        label: `${scenario} t${t.n} (as_heard)`,
      });
    }
  }
  if (!jobs.length) { console.warn(`[tts-synth] no user turns matched in ${scenario}`); return null; }

  const todo = jobs.filter((j) => opts.force || !existsSync(j.outWav));
  console.log(`[tts-synth] ${scenario}: ${jobs.length} files (${todo.length} to synth, ${jobs.length - todo.length} cached)`);

  const done = await pool(todo, 3, async (j) => {
    const tmpMp3 = join(tmpDir, `${createHash('sha1').update(j.label).digest('hex').slice(0, 12)}.mp3`);
    const info = await synthTurn({ text: j.text, outWav: j.outWav, tmpMp3, label: j.label });
    console.log(`  ok ${j.label} -> ${info.duration_s.toFixed(2)}s`);
    return { job: j, info };
  });
  const byLabel = new Map(done.map((d) => [d.job.label, d]));

  const manifest = {
    scenario_id: scenario,
    order_id: guion.order_id,
    voice: VOICE,
    format: { sample_rate: SAMPLE_RATE, channels: 1, codec: 'pcm_s16le' },
    source: 'edge-tts (DEV-ONLY test audio; never for the demo video or published artifacts)',
    usage: 'Replay through speakers into the mic for D2 gate noise sessions; clean refs for WER (metrics/cli.js).',
    turns: jobs.map((j) => {
      const d = byLabel.get(j.label);
      const duration_s = d ? d.info.duration_s : null;
      return {
        n: j.n,
        variant: j.variant,
        file: j.outWav.slice(OUT_ROOT.length + 1),
        text: j.text,
        duration_s: duration_s == null ? Number.NaN : Number(duration_s.toFixed(3)),
        bytes: existsSync(j.outWav) ? statSync(j.outWav).size : null,
      };
    }),
  };
  const manifestPath = join(outDir, 'manifest.json');
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  const totalDur = manifest.turns.reduce((a, t) => a + (t.duration_s || 0), 0);
  console.log(`[tts-synth] ${scenario}: manifest + ${manifest.turns.length} wavs, ${totalDur.toFixed(1)}s speech total`);
  return manifest;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const guionDir = join(ROOT, 'data', 'guiones');
  const files = readdirSync(guionDir).filter((f) => f.endsWith('.json')).sort()
    .filter((f) => !opts.guiones || opts.guiones.some((g) => f.startsWith(g)));
  if (!files.length) throw new Error(`no guiones matched in ${guionDir}`);
  const manifests = [];
  for (const f of files) manifests.push(await synthScenario(join(guionDir, f), opts));
  const ok = manifests.filter(Boolean);
  const nFiles = ok.reduce((a, m) => a + m.turns.length, 0);
  const totalDur = ok.reduce((a, m) => a + m.turns.reduce((b, t) => b + (t.duration_s || 0), 0), 0);
  console.log(`[tts-synth] DONE: ${ok.length} scenarios, ${nFiles} wavs, ${totalDur.toFixed(1)}s speech -> ${OUT_ROOT}`);
}

main().catch((e) => { console.error(`[tts-synth] FATAL: ${e.message}`); process.exit(1); });

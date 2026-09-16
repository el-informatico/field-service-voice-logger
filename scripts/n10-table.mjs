#!/usr/bin/env node
/**
 * n10-table.mjs — agrega las métricas del README (tabla N sesiones, dominio incidente).
 *
 * Combina lo que metrics/cli.js ya agrega (latencia p50/p95, severidad exacta,
 * servicios P/R, timeline, action items, confirmaciones) con lo que falta para
 * la tabla pública:
 *   - turn completion por sesión (matcher greedy orden-preservado, overlap ≥0.4)
 *   - WER de pares matched (robusto a splits del VAD — misma receta que gate-eval.mjs)
 *
 * Uso:
 *   node scripts/n10-table.mjs <artifact.json...>
 * (empareja GT por scenario_id embebido en cada artefacto; dominio incidente)
 */
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const paths = process.argv.slice(2).filter((a) => !a.startsWith('-'));
if (!paths.length) { console.error('uso: node scripts/n10-table.mjs <artifact.json...>'); process.exit(2); }

const norm = (s) => (s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9\s/]/g, ' ').replace(/\s+/g, ' ').trim();
const tokens = (s) => new Set(norm(s).split(' ').filter((w) => w.length > 2));
const overlap = (a, b) => {
  const A = tokens(a), B = tokens(b);
  if (!A.size || !B.size) return 0;
  let i = 0; for (const w of A) if (B.has(w)) i++;
  return i / Math.min(A.size, B.size);
};
const words = (s) => norm(s).split(' ').filter(Boolean);
const ed = (a, b) => { // Levenshtein por palabras
  const m = a.length, n = b.length;
  const d = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
  for (let j = 0; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++)
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[m][n];
};
const pct = (x) => (x == null ? '—' : `${(100 * x).toFixed(1)}%`);

/* ------- por sesión: turn completion + matched-WER (receta gate-eval) ------- */
const perSession = [];
const gtPaths = new Map(); // scenario_id -> path GT (para el CLI, dedup)
let tlHoraTP = 0, tlHoraFN = 0; // timeline por HORA exacta (pool)
for (const p of paths) {
  const art = JSON.parse(readFileSync(p.startsWith('/') ? p : join(ROOT, p), 'utf8'));
  const sid = art.scenario_id ?? art.meta?.scenario_id;
  if (!sid) { console.error(`  ⚠ ${p}: sin scenario_id — excluido`); continue; }
  const guion = JSON.parse(readFileSync(join(ROOT, 'data/guiones-incidente', `${sid}.json`), 'utf8'));
  const gt = JSON.parse(readFileSync(join(ROOT, 'data/ground-truth-incidente', `gt-${sid}.json`), 'utf8'));
  gtPaths.set(sid, join(ROOT, 'data/ground-truth-incidente', `gt-${sid}.json`));
  const horasPred = new Set((art.final_form.timeline ?? []).map((e) => e.hora));
  for (const ev of gt.expected_form.timeline ?? []) {
    if (horasPred.has(ev.hora)) tlHoraTP++; else tlHoraFN++;
  }

  const refs = guion.turns.filter((t) => t.role === 'user');
  const hyps = art.transcript.filter((t) => t.role === 'user').map((t) => t.text ?? '');
  const matchedHyp = new Set();
  let completed = 0, errW = 0, refW = 0;
  let cursor = 0;
  for (const r of refs) {
    let best = -1, bestScore = 0;
    for (let j = cursor; j < hyps.length; j++) {
      if (matchedHyp.has(j)) continue;
      const s = overlap(r.text, hyps[j]);
      if (s > bestScore) { bestScore = s; best = j; }
      if (s >= 0.4) break;
    }
    if (best >= 0 && bestScore >= 0.4) {
      completed++; matchedHyp.add(best);
      errW += ed(words(r.text), words(hyps[best])); refW += words(r.text).length;
      if (best >= cursor) cursor = best + 1;
    }
  }
  const label = art.turn_detection?.label ?? p.match(/-([A-Za-z0-9]+)\.json$/)?.[1] ?? '?';
  perSession.push({ file: p.split('/').pop(), label, sid, completed, refs: refs.length, errW, refW,
    tools: art.events.filter((e) => e.type === 'tool_call').length });
}

/* ------- aggregate del harness (latencia, extracción, confirmaciones) ------- */
const args = [join(ROOT, 'metrics/cli.js'), ...paths.map((p) => (p.startsWith('/') ? p : join(ROOT, p))), '--gt', ...gtPaths.values(), '--json'];
const j = JSON.parse(execFileSync('node', args, { encoding: 'utf8', maxBuffer: 1 << 26, stdio: ['ignore', 'pipe', 'ignore'] }));
const agg = j.aggregate;
const ext = agg.extraction ?? {};

/* ------- salida ------- */
const totErr = perSession.reduce((s, x) => s + x.errW, 0);
const totRef = perSession.reduce((s, x) => s + x.refW, 0);
const compl = perSession.map((x) => x.completed);
const refsN = perSession.map((x) => x.refs);
const werPer = perSession.filter((x) => x.refW > 0).map((x) => x.errW / x.refW);

console.log(`# sesiones: ${perSession.length}`);
console.log('\n## Por sesión (matcher)');
for (const s of perSession) {
  console.log(`${s.label.padEnd(4)} ${s.sid.padEnd(22)} turnos ${s.completed}/${s.refs} · tools=${s.tools} · matchedWER=${s.refW ? (s.errW / s.refW).toFixed(3) : '—'} (${s.refW}w)`);
}
console.log('\n## Tabla README (agregados N=' + perSession.length + ')');
console.log(`| Turn completion | ${Math.min(...compl)}–${Math.max(...compl)} of ${Math.min(...refsN)}–${Math.max(...refsN)} per session | ${perSession.length} sessions |`);
console.log(`| WER matched (pooled) | ${totRef ? (totErr / totRef).toFixed(3) : '—'} (${(totRef / perSession.length).toFixed(0)}w/session avg) | ${totRef} ref words |`);
console.log(`| WER matched rango/sesión | ${Math.min(...werPer).toFixed(3)}–${Math.max(...werPer).toFixed(3)} | ${perSession.length} |`);
console.log(`| EOS→tool p50/p95 | ${agg.latency?.tool?.p50} / ${Math.round(agg.latency?.tool?.p95)} ms | ${agg.latency?.tool?.n} tool turns |`);
console.log(`| Severidad exacta | ${ext.per_field?.severidad ? ext.per_field.severidad.correct + '/' + ext.per_field.severidad.n : '—'} | aggregate |`);
console.log(`| Servicios P / R | ${pct(ext.servicios_afectados?.precision)} (TP ${ext.servicios_afectados?.tp}/FP ${ext.servicios_afectados?.fp}) / ${pct(ext.servicios_afectados?.recall)} (FN ${ext.servicios_afectados?.fn}) | aggregate |`);
console.log(`| Timeline hora exacta | ${tlHoraTP} TP / ${tlHoraFN} FN (${pct(tlHoraTP / Math.max(1, tlHoraTP + tlHoraFN))}) | pool de eventos GT |`);
console.log(`| Timeline hora+evento (estricto, sim≥0.6) | ${ext.timeline?.tp} TP / ${ext.timeline?.fp} FP / ${ext.timeline?.fn} FN | aggregate |`);
console.log(`| Action items recall | ${pct(ext.action_items ? ext.action_items.covered / Math.max(1, ext.action_items.n_gt) : null)} (${ext.action_items?.covered}/${ext.action_items?.n_gt}) | aggregate |`);
const conf = agg.confirmation ?? agg.confirmation_loop;
if (conf) console.log(`| Confirm precision | ${pct(conf.precision)} | ${JSON.stringify(Object.fromEntries(Object.entries(conf).filter(([k]) => k.startsWith('n_'))))} |`);

#!/usr/bin/env node
/**
 * gate-eval.mjs — evalúa un artefacto del GATE D2 contra los criterios C1-C4.
 *
 *   node scripts/gate-eval.mjs <artifact.json>
 *
 * C1 turn completion: fracción de turnos user del guion con match (solapamiento
 *    de tokens ≥0.4) contra algún turno user del transcript.
 * C2 false turn-ends: turnos user del transcript SIN match contra el guion
 *    (splits espurios / disparos del VAD) por sesión.
 * C3 barge-in: % respetados (latency ≤500 ms o interruption confirmada) sobre los
 *    interrumpidos deliberados (guion con interrupt) — leído del artefacto.
 * WER: salida del harness (node metrics/cli.js) emparejado cronológicamente; se
 *    reporta también el WER de pares matched (robusto a splits).
 */
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const artPath = process.argv[2];
if (!artPath) { console.error('uso: node scripts/gate-eval.mjs <artifact.json>'); process.exit(2); }
const art = JSON.parse(readFileSync(artPath.startsWith('/') ? artPath : join(ROOT, artPath), 'utf8'));
const guion = JSON.parse(readFileSync(join(ROOT, 'data/guiones', `${art.scenario_id}.json`), 'utf8'));

const norm = (s) => (s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9\s/]/g, ' ').replace(/\s+/g, ' ').trim();
const tokens = (s) => new Set(norm(s).split(' ').filter((w) => w.length > 2));
const overlap = (a, b) => {
  const A = tokens(a), B = tokens(b);
  if (!A.size || !B.size) return 0;
  let i = 0; for (const w of A) if (B.has(w)) i++;
  return i / Math.min(A.size, B.size);
};

const refs = guion.turns.filter((t) => t.role === 'user');
const hyps = art.transcript.filter((t) => t.role === 'user').map((t) => t.text ?? '');

// matching greedy por orden (turnos del guion en secuencia contra hipótesis en secuencia)
const matchedHyp = new Set();
let completed = 0;
const matchPairs = [];
let cursor = 0;
for (const r of refs) {
  let best = -1, bestScore = 0;
  for (let j = cursor; j < hyps.length; j++) {
    if (matchedHyp.has(j)) continue;
    const s = overlap(r.text, hyps[j]);
    if (s > bestScore) { bestScore = s; best = j; }
    if (s >= 0.4) break; // primer hipótetis suficientemente buena (orden preservado)
  }
  if (best >= 0 && bestScore >= 0.4) { completed++; matchedHyp.add(best); matchPairs.push([r, hyps[best]]); if (best >= cursor) cursor = best + 1; }
}
const falseEnds = hyps.filter((_, j) => !matchedHyp.has(j) && norm(hyps[j]).length > 0).length
  + hyps.filter((h) => norm(h).length === 0).length;
const emptyTurns = hyps.filter((h) => norm(h).length === 0).length;

// C3: barge-ins registrados
const barges = art.events.filter((e) => e.type === 'barge_in');
const respected = barges.filter((b) => b.latency_ms == null || b.latency_ms <= 500).length;
const provoked = guion.turns.filter((t) => t.role === 'user' && t.interrupt).length;

// WER (harness, cronológico) + WER matched (solo pares emparejados)
let werChrono = null, nRef = null;
try {
  const out = execFileSync('node', [join(ROOT, 'metrics/cli.js'), artPath.startsWith('/') ? artPath : join(ROOT, artPath),
    '--gt', join(ROOT, 'data/ground-truth', `gt-${art.scenario_id}.json`), '--json'], { encoding: 'utf8', maxBuffer: 1 << 24 });
  const j = JSON.parse(out);
  const a = j.aggregate ?? j;
  werChrono = a.wer?.wer ?? null; nRef = a.wer?.n_ref ?? null;
} catch { /* el CLI imprime tabla si falla — seguimos */ }
const words = (s) => norm(s).split(' ').filter(Boolean);
const ed = (a, b) => { // Levenshtein por palabras
  const m = a.length, n = b.length;
  const d = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
  for (let j = 0; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++)
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[m][n];
};
let errW = 0, refW = 0;
for (const [r, h] of matchPairs) { const R = words(r.text), H = words(h); errW += ed(R, H); refW += R.length; }
const werMatched = refW ? +(errW / refW).toFixed(3) : null;

console.log(JSON.stringify({
  artifact: artPath.split('/').pop(),
  noise: art.noise_condition,
  params: art.turn_detection?.vad_threshold ?? null,
  C1_turn_completion: +(completed / refs.length).toFixed(2),
  C1_detail: `${completed}/${refs.length}`,
  C2_false_turn_ends: falseEnds,
  empty_user_turns: emptyTurns,
  C3_barge: provoked ? `${respected}/${barges.length} (provocados ${provoked})` : `${respected}/${barges.length}`,
  C4_wer_chrono: werChrono != null ? +(+werChrono).toFixed(3) : null,
  C4_wer_matched: werMatched,
  n_ref_words: nRef,
  tools: art.events.filter((e) => e.type === 'tool_call').length,
  piezas: (art.final_form.piezas ?? []).map((p) => `${p.sku}x${p.qty}${p.confirmada ? '✓' : '?'}`),
}, null, 1));

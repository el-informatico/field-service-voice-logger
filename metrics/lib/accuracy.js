// accuracy.js — extraction accuracy: artifact.final_form vs ground-truth expected_form.
// Doc §8: problema/diagnostico/solucion similarity ≥ 0.8; piezas set-level P/R/F1 over
// exact (sku, qty) pairs + exact_set; tiempo_minutos |pred−gt| ≤ 5.
import { similarity } from './textnorm.js';

const SIM_THRESHOLD = 0.8;
const TIEMPO_TOL = 5;

function piezasPR(pred = [], gt = []) {
  const key = (p) => `${p.sku}::${p.qty}`;
  const P = new Set(pred.map(key)), G = new Set(gt.map(key));
  let tp = 0;
  for (const k of P) if (G.has(k)) tp++;
  const fp = P.size - tp, fn = G.size - tp;
  const precision = P.size ? tp / P.size : G.size ? 0 : 1;
  const recall = G.size ? tp / G.size : P.size ? 0 : 1;
  const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
  return { tp, fp, fn, precision, recall, f1, exact_set: fp === 0 && fn === 0 };
}

/**
 * @returns structured per-field results + overall extraction accuracy
 * (correct fields ÷ evaluated fields — evaluated = present in GT).
 */
export function accuracy(finalForm = {}, gt = {}) {
  const fields = {};
  let correct = 0, evaluated = 0;
  for (const f of ['problema', 'diagnostico', 'solucion']) {
    if (gt[f] == null) continue; // not evaluated
    const sim = similarity(finalForm[f] ?? '', gt[f]);
    const ok = sim >= SIM_THRESHOLD;
    fields[f] = { present: finalForm[f] != null, similarity: sim, threshold: SIM_THRESHOLD, correct: ok };
    evaluated++; if (ok) correct++;
  }
  if (gt.piezas != null) {
    const pr = piezasPR(finalForm.piezas ?? [], gt.piezas);
    const ok = pr.exact_set;
    fields.piezas = { ...pr, n_pred: (finalForm.piezas ?? []).length, n_gt: gt.piezas.length, correct: ok };
    evaluated++; if (ok) correct++;
  }
  if (gt.tiempo_minutos != null) {
    const pred = finalForm.tiempo_minutos;
    const ok = pred != null && Math.abs(pred - gt.tiempo_minutos) <= TIEMPO_TOL;
    fields.tiempo_minutos = { pred, gt: gt.tiempo_minutos, tolerance: TIEMPO_TOL, correct: ok };
    evaluated++; if (ok) correct++;
  }
  return {
    fields,
    correct_fields: correct,
    evaluated_fields: evaluated,
    overall: evaluated ? correct / evaluated : null,
  };
}

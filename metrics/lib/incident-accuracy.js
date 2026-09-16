// incident-accuracy.js — extraction accuracy for the INCIDENTE domain (Plan B).
// Contract docs/incident-contract.md §7:
//   resumen, que_paso    : similarity ≥ 0.8 (same textnorm as problema/solución).
//   servicios_afectados  : set P/R/F1 over exact service ids (same as piezas).
//   timeline             : a predicted event matches a GT event iff hora is
//                          EXACT and evento similarity ≥ 0.6 → set P/R/F1.
//   action_items         : recall by coverage — a GT item is covered if any
//                          predicted item has similarity ≥ 0.6.
//   severidad            : exact.
// Same result shape style as accuracy.js: per-field entry under `fields`, plus
// overall = correct fields ÷ evaluated fields (evaluated = present in GT).

import { similarity } from './textnorm.js';

const SIM_THRESHOLD = 0.8;
const EVENTO_SIM_THRESHOLD = 0.6;
const ACTION_SIM_THRESHOLD = 0.6;

function prf(tp, nPred, nGt) {
  const fp = nPred - tp, fn = nGt - tp;
  const precision = nPred ? tp / nPred : nGt ? 0 : 1;
  const recall = nGt ? tp / nGt : nPred ? 0 : 1;
  const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
  return { tp, fp, fn, precision, recall, f1, exact_set: fp === 0 && fn === 0 };
}

/** Set P/R/F1 over exact ids (duplicates collapse, like piezas over sku::qty). */
function serviciosPR(pred = [], gt = []) {
  const P = new Set(pred.map((s) => String(s?.id ?? '')));
  const G = new Set(gt.map((s) => String(s?.id ?? '')));
  let tp = 0;
  for (const id of P) if (G.has(id)) tp++;
  return { ...prf(tp, P.size, G.size), n_pred: pred.length, n_gt: gt.length };
}

/**
 * Timeline set matching. Deterministic greedy in GT order: each GT event takes
 * the FIRST still-unused predicted event with the exact same hora and evento
 * similarity ≥ 0.6. TP = matches, FP = unmatched predictions, FN = unmatched GT.
 */
function timelinePR(pred = [], gt = []) {
  const used = new Array(pred.length).fill(false);
  const matches = [];
  let tp = 0;
  for (const g of gt) {
    for (let j = 0; j < pred.length; j++) {
      if (used[j]) continue;
      if (String(pred[j]?.hora ?? '') !== String(g?.hora ?? '')) continue;
      const sim = similarity(pred[j]?.evento ?? '', g?.evento ?? '');
      if (sim < EVENTO_SIM_THRESHOLD) continue;
      used[j] = true;
      tp++;
      matches.push({ hora: String(g.hora ?? ''), evento_similarity: sim });
      break;
    }
  }
  return {
    ...prf(tp, pred.length, gt.length),
    n_pred: pred.length,
    n_gt: gt.length,
    evento_threshold: EVENTO_SIM_THRESHOLD,
    matches,
  };
}

/** Recall by coverage: GT item covered iff some predicted item is similar enough. */
function actionItemsRecall(pred = [], gt = []) {
  let covered = 0;
  const details = [];
  for (const g of gt) {
    let best = 0, hit = false;
    for (const p of pred) {
      const sim = similarity(p ?? '', g);
      if (sim > best) best = sim;
      if (sim >= ACTION_SIM_THRESHOLD) hit = true;
    }
    if (hit) covered++;
    details.push({ covered: hit, best_similarity: best });
  }
  const recall = gt.length ? covered / gt.length : 1;
  return { covered, n_gt: gt.length, n_pred: pred.length, recall, threshold: ACTION_SIM_THRESHOLD, details, correct: covered === gt.length };
}

/** severidad exacta (enum baja|media|alta|critica — compare lowercased). */
function severidadExact(pred, gt) {
  const p = pred == null ? null : String(pred).toLowerCase();
  const g = gt == null ? null : String(gt).toLowerCase();
  return { pred: p, gt: g, correct: p === g };
}

/**
 * @param {Object} finalForm   artifact.final_form (incidente §2 shape)
 * @param {Object} expectedForm gt.expected_form
 * @returns structured per-field results + overall extraction accuracy
 */
export function compareIncident(finalForm = {}, expectedForm = {}) {
  const fields = {};
  let correct = 0, evaluated = 0;

  for (const f of ['resumen', 'que_paso']) {
    if (expectedForm[f] == null) continue; // not evaluated
    const sim = similarity(finalForm[f] ?? '', expectedForm[f]);
    const ok = sim >= SIM_THRESHOLD;
    fields[f] = { present: finalForm[f] != null, similarity: sim, threshold: SIM_THRESHOLD, correct: ok };
    evaluated++; if (ok) correct++;
  }
  if (expectedForm.servicios_afectados != null) {
    const pr = serviciosPR(finalForm.servicios_afectados ?? [], expectedForm.servicios_afectados);
    fields.servicios_afectados = { ...pr, correct: pr.exact_set };
    evaluated++; if (pr.exact_set) correct++;
  }
  if (expectedForm.timeline != null) {
    const pr = timelinePR(finalForm.timeline ?? [], expectedForm.timeline);
    fields.timeline = { ...pr, correct: pr.exact_set };
    evaluated++; if (pr.exact_set) correct++;
  }
  if (expectedForm.action_items != null) {
    const r = actionItemsRecall(finalForm.action_items ?? [], expectedForm.action_items);
    fields.action_items = r;
    evaluated++; if (r.correct) correct++;
  }
  if (expectedForm.severidad != null) {
    const s = severidadExact(finalForm.severidad, expectedForm.severidad);
    fields.severidad = s;
    evaluated++; if (s.correct) correct++;
  }
  return {
    domain: 'incidente',
    fields,
    correct_fields: correct,
    evaluated_fields: evaluated,
    overall: evaluated ? correct / evaluated : null,
  };
}

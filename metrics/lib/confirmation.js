// confirmation.js — the spoken-confirmation-loop metric (doc §8.3).
//
// recall   = seeded errors rescued ÷ seeded errors total.
//            Rescued = exists confirm_request whose field/value matches the seeded
//            WRONG captured value, and a LATER form_update/confirm_result where the
//            field ends matching truth (confirm_result confirmed=false, or a corrected
//            value, or form_update whose snapshot contains the true value for that field).
// precision = confirm_requests that ended in a correction ÷ confirm_requests total.
//            Read-backs raised where nothing was wrong = false alarms.

import { similarity } from './textnorm.js';

const normPieceKey = (p) => (p && typeof p === 'object' ? `${p.sku ?? ''}::${p.qty ?? ''}` : String(p ?? ''));

function valueMatches(a, b) {
  if (a === b) return true;
  if (a == null || b == null) return false;
  if (typeof a === 'object' || typeof b === 'object') return normPieceKey(a) === normPieceKey(b);
  if (typeof a === 'number' || typeof b === 'number') return Number(a) === Number(b);
  return similarity(String(a), String(b)) >= 0.8;
}

function truthValueFor(field, gtForm) {
  if (gtForm == null) return undefined;
  if (field === 'pieza') return gtForm.piezas; // array of {sku,qty}
  return gtForm[field];
}

function truthHas(field, wrongValue, gtForm) {
  // true if the WRONG value does NOT match truth (i.e. it was a real error).
  const tv = truthValueFor(field, gtForm);
  if (field === 'pieza') {
    const arr = Array.isArray(tv) ? tv : [];
    return !arr.some((p) => valueMatches(p, wrongValue));
  }
  return !valueMatches(tv, wrongValue);
}

function laterCorrectedToTruth(reqIdx, field, wrongValue, events, gtForm) {
  const tv = truthValueFor(field, gtForm);
  const matchesTruth = (v) => {
    if (field === 'pieza') {
      const arr = Array.isArray(v) ? v : [];
      // corrected if the wrong value is gone AND some true piece present later
      const wrongGone = !arr.some((p) => valueMatches(p, wrongValue));
      const hasTrue = Array.isArray(tv) && arr.some((p) => tv.some((g) => valueMatches(p, g)));
      return wrongGone && (hasTrue || (Array.isArray(tv) && tv.length === 0));
    }
    return valueMatches(v, tv);
  };
  for (let j = reqIdx + 1; j < events.length; j++) {
    const e = events[j];
    if (e.type === 'user_turn_start') continue; // corrections may span turns
    if (e.type === 'confirm_request') return false; // a new read-back supersedes
    if (e.type === 'form_update' && (e.changed ?? []).includes(field === 'pieza' ? 'piezas' : field)) {
      if (matchesTruth(e.form ? (field === 'pieza' ? e.form.piezas : e.form[field]) : undefined)) return true;
    }
    if (e.type === 'confirm_result' && e.field === field) {
      if (e.confirmed === false) return true; // technician said no → counts as correction start
      if (e.value != null && !valueMatches(e.value, wrongValue) && matchesTruth(e.value)) return true;
    }
  }
  return false;
}

/**
 * @param {Array} events artifact.events[]
 * @param {Array} seededErrors gt.seeded_errors: [{field, wrong_value}]
 * @param {Object} gtForm gt.expected_form (for "what is truth")
 * @returns {{n_requests, n_corrections, n_false_alarms, precision, recall,
 *            rescued:[], unrescued:[], request_details:[]}}
 */
export function confirmation(events, seededErrors = [], gtForm = {}) {
  const evs = [...(events ?? [])].sort((a, b) => (a.t_ms ?? 0) - (b.t_ms ?? 0));
  const requests = evs.map((e, i) => ({ e, i })).filter(({ e }) => e.type === 'confirm_request');

  const requestDetails = requests.map(({ e, i }) => {
    const corrected = laterCorrectedToTruth(i, e.field, e.value, evs, gtForm);
    const realError = truthHas(e.field, e.value, gtForm);
    return { t_ms: e.t_ms, field: e.field, value: e.value, was_real_error: realError, ended_in_correction: corrected };
  });

  const rescued = [], unrescued = [];
  for (const err of seededErrors) {
    // wrong captured value: `wrong_value` (doc schema) or `captured` (data/ground-truth shape)
    const wrongValue = err.wrong_value ?? err.captured;
    // find a confirm_request matching the seeded wrong value that got corrected
    const hit = requestDetails.some(
      (d) => d.field === err.field && valueMatches(d.value, wrongValue) && d.ended_in_correction,
    );
    (hit ? rescued : unrescued).push(err);
  }

  const n_requests = requestDetails.length;
  const n_corrections = requestDetails.filter((d) => d.ended_in_correction).length;
  const n_false_alarms = n_requests - n_corrections;
  return {
    n_requests,
    n_corrections,
    n_false_alarms,
    precision: n_requests ? n_corrections / n_requests : null,
    recall: seededErrors.length ? rescued.length / seededErrors.length : null,
    n_seeded_errors: seededErrors.length,
    rescued,
    unrescued,
    request_details: requestDetails,
  };
}

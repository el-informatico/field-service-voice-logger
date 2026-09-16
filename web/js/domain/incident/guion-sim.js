/**
 * guion-sim.js (incidente) — enriquece un guion de incidente con las señales
 * de simulación que el mock consume por turno: `as_heard` (transcripción mal
 * oída) e `interrupt` (barge-in provocado). ESM, sin dependencias, DOM-free.
 * Espejo de web/js/guion-sim.js (orden).
 *
 * DERIVACIÓN DATADRIVEN (preferida): el ground-truth declara ambos fenómenos:
 *  - gt.seeded_errors[{field:'servicio', captured:{id}, truth:{id}}] → en el
 *    turno user que menciona el servicio VERDADERO se sustituye su alias
 *    hablado por el del capturado (cómo lo mal-oyó el ASR).
 *  - gt.seeded_errors[{field:'hora', captured:'09:20', truth:'09:40'}] → en
 *    el turno user que dice la hora VERDADERA se sustituye su forma hablada
 *    por la de la hora mal oída ("nueve cuarenta" → "nueve veinte").
 *  - gt.seeded_errors[{field:'severidad', ...}] → no toca el audio: el
 *    operador SÍ dice el valor capturado; lo rescata el read-back.
 *  - gt.provoked_interruptions[{during_turn: n}] (turno AGENTE n) → el turno
 *    user n+1 lleva interrupt:true.
 *
 * Los guiones ya pueden traer as_heard/interrupt embebidos (como los de
 * orden traen el de s2): en ese caso se respetan tal cual.
 */

import { tokenSet } from '../../dialog-act.js';

/** Palabra hablada de un número 0–59 (para horas). */
const NUM_WORD = [
  'cero', 'una', 'dos', 'tres', 'cuatro', 'cinco', 'seis', 'siete', 'ocho',
  'nueve', 'diez', 'once', 'doce', 'trece', 'catorce', 'quince', 'dieciséis',
  'diecisiete', 'dieciocho', 'diecinueve', 'veinte', 'veintiuna', 'veintidós',
  'veintitrés', 'veinticuatro', 'veinticinco', 'veintiséis', 'veintisiete',
  'veintiocho', 'veintinueve', 'treinta', 'treinta y una', 'treinta y dos',
  'treinta y tres', 'treinta y cuatro', 'treinta y cinco', 'treinta y seis',
  'treinta y siete', 'treinta y ocho', 'treinta y nueve', 'cuarenta',
  'cuarenta y una', 'cuarenta y dos', 'cuarenta y tres', 'cuarenta y cuatro',
  'cuarenta y cinco', 'cuarenta y seis', 'cuarenta y siete', 'cuarenta y ocho',
  'cuarenta y nueve', 'cincuenta', 'cincuenta y una', 'cincuenta y dos',
  'cincuenta y tres', 'cincuenta y cuatro', 'cincuenta y cinco',
  'cincuenta y seis', 'cincuenta y siete', 'cincuenta y ocho',
  'cincuenta y nueve',
];

/** "09:40" → ['nueve cuarenta', '9:40', '09:40'] (formas de decirla/escribirla). */
function horasFormas(hora) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hora ?? ''));
  if (!m) return [];
  const h = +m[1];
  const min = +m[2];
  const hWord = h === 0 ? 'doce' : NUM_WORD[h] ?? String(h);
  const minWord = min === 0 ? '' : NUM_WORD[min] ?? String(min);
  const formas = [];
  if (minWord) formas.push(`${hWord} ${minWord}`, `${hWord} con ${minWord}`);
  else formas.push(`${hWord} en punto`);
  formas.push(`${h}:${String(min).padStart(2, '0')}`);
  formas.push(`${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`);
  return formas;
}

/**
 * @param {object} guion    guion tal cual de data/guiones-incidente/*.json
 * @param {object|null} gt  ground-truth (data/ground-truth-incidente/…) o null
 * @param {Array}  [servicios] catálogo (para el swap de alias del error de servicio)
 * @returns {object} copia del guion con turnos user enriquecidos (as_heard/interrupt)
 */
export function prepareIncidentGuion(guion, gt = null, servicios = []) {
  const turns = (guion.turns ?? []).map((t) => ({ ...t }));
  const enriched = { ...guion, turns };

  // 1) interrupciones provocadas: durante el turno agent n → user n+1
  for (const p of gt?.provoked_interruptions ?? []) {
    const n = (p.during_turn ?? 0) + 1;
    const t = turns.find((x) => x.n === n);
    if (t && t.role === 'user') t.interrupt = true;
  }
  if (!gt) return enriched;

  // 2) errores sembrados → as_heard en el turno que menciona la verdad
  for (const err of gt.seeded_errors ?? []) {
    if (err.field === 'servicio' && err.truth?.id && err.captured?.id) {
      swapServicio(turns, err.truth.id, err.captured.id, servicios);
    } else if (err.field === 'hora' && err.truth && err.captured) {
      swapHora(turns, String(err.truth), String(err.captured));
    }
    /* severidad: el audio dice el valor capturado (lo rescata el read-back):
     * no hay sustitución que hacer. */
  }
  return enriched;
}

/** Sustituye el alias hablado del servicio verdad por el del capturado. */
function swapServicio(turns, truthId, capturedId, servicios) {
  const truth = servicios.find((s) => s.id === truthId);
  const captured = servicios.find((s) => s.id === capturedId);
  if (!truth || !captured) return;
  // alias del verdad ordenados por longitud (el más específico primero)
  const aliasTruth = [...(truth.alias ?? []), truth.nombre]
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);
  const aliasCaptured = [...(captured.alias ?? []), captured.nombre]
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);
  // tokens que SOLO el capturado tiene: el cabreo del ASR (p. ej. 'staging')
  const tokTruth = tokenSet([...(truth.alias ?? []), truth.nombre, truth.id].join(' '));
  const tokCapt = tokenSet([...(captured.alias ?? []), captured.nombre, captured.id].join(' '));
  const distintivo = [...tokCapt].find((t) => !tokTruth.has(t) && t.length > 3);
  for (const t of turns) {
    if (t.role !== 'user' || t.as_heard) continue;
    const presente = aliasTruth.find((a) => t.text?.toLowerCase().includes(a.toLowerCase()));
    if (!presente) continue;
    const reemplazo = distintivo ? `el ${distintivo}` : aliasCaptured[0] ?? distintivo;
    t.as_heard = t.text.replace(new RegExp(escapeRe(presente), 'i'), reemplazo);
    return; // solo el primer turno que lo menciona
  }
}

/** Sustituye la forma hablada de la hora verdad por la de la capturada. */
function swapHora(turns, truthHora, capturedHora) {
  const formasTruth = horasFormas(truthHora);
  const formasCaptured = horasFormas(capturedHora);
  if (!formasTruth.length || !formasCaptured.length) return;
  for (const t of turns) {
    if (t.role !== 'user' || t.as_heard) continue;
    const forma = formasTruth.find((f) => t.text?.toLowerCase().includes(f.toLowerCase()));
    if (!forma) continue;
    t.as_heard = t.text.replace(new RegExp(escapeRe(forma), 'i'), formasCaptured[0]);
    return; // solo el primer turno que la dice
  }
}

function escapeRe(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

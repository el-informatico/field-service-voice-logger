/**
 * guion-sim.js — enriquece un guion con las señales de simulación que el
 * mock-agent consume por turno: `as_heard` (transcripción mal oída) e
 * `interrupt` (barge-in provocado). ESM, sin dependencias, DOM-free.
 *
 * DERIVACIÓN DATADRIVEN (preferida): el ground-truth declara ambos fenómenos:
 *  - gt.seeded_errors[{field:'pieza', captured, truth}] → en el turno user con
 *    expect 'tool:buscar_pieza' que menciona la dimensión de la pieza VERDADERA,
 *    se sustituye la frase hablada por su forma mal oída ("tres cuartos" →
 *    "tres punto ocho", cómo la transcribiría un ASR que oyó un decimal).
 *  - gt.provoked_interruptions[{during_turn: n}] (turno AGENTE n) → el turno
 *    user n+1 lleva interrupt:true.
 *
 * FALLBACK: sin GT a la mano se usa la tabla por escenario (mismos datos,
 * hardcodeados) — data/guiones/*.json no lleva as_heard/interrupt hoy.
 */

/** Cómo mal-oye el ASR una dimensión (forma hablada → forma mal oída). */
const MISHEARD_FORM = {
  '3/4': 'tres punto ocho',   // "tres cuartos" oído como decimal 3.8 (caso s2)
  '3/8': 'tres punto cuatro',
  '1/2': 'tres cuartos',
  '5/8': 'media pulgada',
  '45+5': 'treinta y cinco más cinco',
  '35+5': 'cuarenta y cinco más cinco',
};

/** Cómo se dice en voz alta cada dimensión (para encontrarla en el guion). */
const SPOKEN_FORM = {
  '3/4': ['tres cuartos', '3/4', 'tres cuartos de pulgada'],
  '3/8': ['tres octavos', '3/8'],
  '1/2': ['media pulgada', 'medio pulgada', '1/2'],
  '5/8': ['cinco octavos', '5/8'],
  '45+5': ['cuarenta y cinco más cinco', '45+5'],
  '35+5': ['treinta y cinco más cinco', '35+5'],
};

const FALLBACK_SIM = {
  's2-pieza-mal-oida': { misheard: { turn: 5, from: 'tres cuartos', to: 'tres punto ocho' } },
  's3-barge-in': { interrupts: [7, 15, 17] },
};

/**
 * @param {object} guion    guion tal cual de data/guiones/*.json
 * @param {object|null} gt  ground-truth correspondiente (data/ground-truth/…) o null
 * @returns {object} copia del guion con turnos user enriquecidos (as_heard/interrupt)
 */
export function prepareGuion(guion, gt = null) {
  const turns = (guion.turns ?? []).map((t) => ({ ...t }));
  const enriched = { ...guion, turns };
  const sid = guion.scenario_id;

  const rules = deriveFromGt(gt) ?? FALLBACK_SIM[sid] ?? {};

  if (rules.misheard) {
    let { turn, from, to } = rules.misheard;
    if (!turn) {
      // localizar el turno del error: primer user con expect tool:buscar_pieza
      // que mencione la forma hablada de la pieza VERDADERA
      const re = new RegExp(escapeRe(from), 'i');
      const t0 = turns.find((x) => x.role === 'user' && x.expect === 'tool:buscar_pieza' && re.test(x.text ?? ''));
      turn = t0?.n ?? null;
    }
    const t = turns.find((x) => x.n === turn);
    if (t && t.role === 'user' && !t.as_heard) {
      const re = new RegExp(escapeRe(from), 'gi');
      if (re.test(t.text)) t.as_heard = t.text.replace(re, to);
    }
  }
  for (const n of rules.interrupts ?? []) {
    const t = turns.find((x) => x.n === n);
    if (t && t.role === 'user') t.interrupt = true;
  }
  return enriched;
}

function deriveFromGt(gt) {
  if (!gt) return null;
  const rules = {};
  const err = (gt.seeded_errors ?? []).find((e) => e.field === 'pieza' && e.captured?.sku && e.truth?.sku);
  if (err) {
    const misheard = misheardRule(err.truth.sku, err.captured.sku);
    if (misheard) rules.misheard = misheard;
  }
  const interrupts = (gt.provoked_interruptions ?? [])
    .map((p) => (p.during_turn ?? 0) + 1)
    .filter((n) => Number.isInteger(n));
  if (interrupts.length) rules.interrupts = interrupts;
  return Object.keys(rules).length ? rules : null;
}

/** Frase a sustituir a partir del par truth/captured (clave: la dimensión). */
function misheardRule(truthSku, capturedSku) {
  const dimTruth = dimensionOf(truthSku);
  if (!dimTruth || !dimensionOf(capturedSku)) return null;
  const from = SPOKEN_FORM[dimTruth]?.[0];
  const to = MISHEARD_FORM[dimTruth];
  if (!from || !to) return null;
  return { from, to };
}

/** Dimensión codificada en el SKU (por familia de catálogo). */
function dimensionOf(sku) {
  const s = String(sku ?? '').toUpperCase();
  if (s.includes('VLV-034')) return '3/4';
  if (s.includes('VLV-038')) return '3/8';
  if (s.includes('VLV-012')) return '1/2';
  if (s.includes('MAN-012')) return '1/2';
  if (s.includes('MAN-058')) return '5/8';
  if (s.includes('455')) return '45+5';
  if (s.includes('355')) return '35+5';
  return null;
}

function escapeRe(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

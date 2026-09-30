/**
 * tool-runner.js — IMPLEMENTACIÓN cliente de las 7 tools contra data/
 * (architecture.md §7). ESM, sin dependencias, DOM-free (browser + Node 22).
 *
 * `createToolRunner({ordenes, piezas, store, clock})` devuelve `{ call(tool, args) }`
 * donde call devuelve SIEMPRE algo JSON-serIALIZABLE `{ok, result}` (el protocolo
 * real manda `result` como string JSON vía tool.result). Las mutaciones de la
 * ficha pasan TODAS por store.applyToolResult — nada escribe directo.
 *
 * Extras internos (solo los usa el mock-agent; NO van en buildToolDefinitions):
 *   set_diagnosis({texto}), set_notes({texto}) — la ficha §6 los tiene pero
 *   las 7 tools públicas del brief no los cubren todavía (decisión D1+).
 */
import { tokenSet, normalizeText, parseQty, stripAccents } from './dialog-act.js';

/* ------------------------------------------------------------------ */
/* esBridge — puente EN→ES para los decoders compartidos               */
/* ------------------------------------------------------------------ */

/**
 * El técnico habla EN, pero el catálogo (data/piezas.json) y los decoders de
 * dialog-act.js (PHRASE_MAP, palabras-número, sustantivos de qty) son ES y
 * están congelados. esBridge adapta la frase EN al vocabulario ES que esos
 * decoders entienden. Se usa SOLO para decisiones internas (scoring de la
 * búsqueda, qty/minutos, tokens distintivos); el texto EN TAL CUAL queda
 * preservado como evidencia en los args/result de las tools.
 */
const EN_ES_FRASES = [
  // frases compuestas ANTES que las palabras sueltas (el orden importa)
  [/\bthree quarters of an inch\b/g, 'tres cuartos de pulgada'],
  [/\bthree eighths of an inch\b/g, 'tres octavos de pulgada'],
  [/\bfive eighths of an inch\b/g, 'cinco octavos de pulgada'],
  [/\bthree quarters\b/g, 'tres cuartos'],
  [/\bthree eighths\b/g, 'tres octavos'],
  [/\bfive eighths\b/g, 'cinco octavos'],
  [/\bthree point eight\b/g, 'tres punto ocho'],
  [/\bthree point four\b/g, 'tres punto cuatro'],
  [/\bhalf an inch\b/g, 'media pulgada'],
  [/\bhalf[- ]inch\b/g, 'media pulgada'],
  [/\ba pair of\b/g, 'un par de'],
  [/\ban hour\b/g, 'una hora'],
  [/\btwenty[- ]four volts?\b/g, 'veinticuatro volts'],
  [/\bnothing else\b/g, 'nada mas'],
  [/\bplus\b/g, 'mas'],
  // sustantivos del catálogo EN→ES
  [/\bvalves?\b/g, 'valvula'],
  [/\bhoses?\b/g, 'manguera'],
  [/\bgaskets?\b/g, 'empaque'],
  [/\bbelts?\b/g, 'banda'],
  [/\bfuses?\b/g, 'fusible'],
  [/\bbearings?\b/g, 'balero'],
  [/\bthermostats?\b/g, 'termostato'],
  [/\bpressure[- ]switch(es)?\b/g, 'presostato'],
  [/\brelays?\b/g, 'relevador'],
  [/\bwashers?\b/g, 'huacha'],
  [/\bpieces?\b/g, 'pieza'],
  [/\bpoles?\b/g, 'polos'],
  [/\bball\b/g, 'bola'],
  [/\bbrass\b/g, 'laton'],
  [/\bneoprene\b/g, 'neopreno'],
  [/\breinforced\b/g, 'reforzada'],
  [/\bmeters?\b/g, 'metro'],
  [/\bminutes?\b/g, 'minutos'],
  [/\bhours?\b/g, 'hora'],
];

const EN_NUM = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7,
  eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13,
  fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18,
  nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60,
  seventy: 70, eighty: 80, ninety: 90,
};

/** EN hablado → pseudo-ES que normalizeText (dialog-act.js) ya entiende. */
export function esBridge(text) {
  let t = stripAccents(String(text ?? '')).toLowerCase();
  for (const [re, es] of EN_ES_FRASES) t = t.replace(re, es);
  return t
    .replace(/\ba hundred\b/g, '100')
    .replace(/\b(two|three|four|five|six|seven|eight|nine)\s+hundred\b/g,
      (_m, w) => String(EN_NUM[w] * 100))
    .replace(/\b(twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)[\s-]+(one|two|three|four|five|six|seven|eight|nine)\b/g,
      (_m, a, b) => String(EN_NUM[a] + EN_NUM[b]))
    .replace(/\b(zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)\b/g,
      (m) => String(EN_NUM[m]));
}

const W_SKU = 3;
const W_NOMBRE = 2;
const W_ALIAS = 2;
const BONUS_SUBSTRING = 3;
const MIN_SCORE = 2;

export function createToolRunner({ ordenes = [], piezas = [], store, clock } = {}) {
  if (!store) throw new Error('createToolRunner: falta store');
  const now = typeof clock?.now === 'function' ? () => clock.now() : () => 0;
  const skuIndex = new Map(piezas.map((p, i) => [p.sku, { pieza: p, idx: i }]));

  async function call(tool, args = {}) {
    try {
      switch (tool) {
        case 'get_order': return ok(getOrden(args));
        case 'search_part': return ok(buscarPieza(args));
        case 'add_part_to_report': return ok(agregarPieza(args));
        case 'set_problem':
        case 'set_diagnosis':
        case 'set_solution':
        case 'set_notes':
          return ok(setTexto(tool, args));
        case 'get_work_time': return ok(getTiempo(args));
        case 'send_report': return ok(enviarReporte());
        default:
          return { ok: false, result: { error: `tool_desconocida:${String(tool)}`, tool } };
      }
    } catch (err) {
      return { ok: false, result: { error: 'tool_error', detalle: String(err?.message ?? err) } };
    }
  }

  /* ---------------------------- tools ---------------------------- */

  function getOrden({ orden_id } = {}) {
    const activa = String(store.final_form.order_id ?? '').trim();
    let id = String(orden_id ?? '').trim();
    let orden = ordenes.find((o) => String(o.id).toLowerCase() === id.toLowerCase());
    // Sin id (o id = la orden activa dicha a medias): devolver la orden ACTIVA
    // de la sesión — la app la asigna al abrir; el técnico no tiene que dictarla.
    if (!orden && (!id || id.toLowerCase() === activa.toLowerCase())) {
      orden = ordenes.find((o) => String(o.id).toLowerCase() === activa.toLowerCase());
      if (orden) id = orden.id;
    }
    if (!orden) {
      return { ok: false, error: 'orden_no_encontrada', orden_id: id,
        disponibles: ordenes.slice(0, 10).map((o) => o.id) };
    }
    store.applyToolResult('get_order', { orden_id: id }, orden);
    return { ok: true, orden };
  }

  /**
   * Búsqueda tolerante: normaliza (minúsculas, sin acentos, números hablados →
   * dígitos, "tres cuartos" → "3/4"), puntúa por solapamiento de tokens contra
   * nombre + alias + sku. Empate → primera del catálogo (orden estable).
   * Siempre reporta el par confundible del best como advertencia.
   */
  function buscarPieza({ consulta } = {}) {
    const q = String(consulta ?? '');
    // scoring/qty sobre el puente EN→ES; `consulta: q` conserva la evidencia EN
    const qB = esBridge(q);
    const qTokens = tokenSet(qB);
    const qNorm = normalizeText(qB);
    const scored = [];
    piezas.forEach((p, idx) => {
      let score = 0;
      const matched = new Set();
      const fields = [[String(p.sku ?? ''), W_SKU], [String(p.nombre ?? ''), W_NOMBRE],
        ...(p.alias ?? []).map((a) => [String(a), W_ALIAS])];
      for (const [field, weight] of fields) {
        const fNorm = normalizeText(field);
        if (fNorm && qNorm.includes(fNorm)) score += BONUS_SUBSTRING; // alias completo dentro de la consulta
        const fTokens = tokenSet(field);
        for (const qt of qTokens) {
          if (matched.has(qt)) continue;
          if (fTokens.has(qt)) { score += weight; matched.add(qt); }
        }
      }
      if (score > 0) scored.push({ pieza: p, idx, score });
    });
    scored.sort((a, b) => (b.score - a.score) || (a.idx - b.idx));
    const found = scored.slice(0, 3).map((s) => ({ sku: s.pieza.sku, nombre: s.pieza.nombre, score: s.score }));
    const bestScored = scored.find((s) => s.score >= MIN_SCORE) ?? null;

    let best = null;
    let confusable_warning = null;
    if (bestScored) {
      const p = bestScored.pieza;
      best = { sku: p.sku, nombre: p.nombre, qty_hint: parseQty(qB).qty };
      const sibs = (p.confundible_con ?? []).filter(Boolean);
      if (sibs.length) {
        const sibSku = sibs[0];
        const sib = skuIndex.get(sibSku)?.pieza ?? null;
        confusable_warning = {
          sku: sibSku,
          nombre: sib ? sib.nombre : null,
          mensaje: `"${p.nombre}" is easily confused with "${sib ? sib.nombre : sibSku}". ` +
            'Ask the disambiguation out loud before accepting the part.',
        };
      }
    }
    const result = { ok: true, consulta: q, found, best, confusable_warning };
    store.applyToolResult('search_part', { consulta: q }, result);
    return result;
  }

  function agregarPieza({ sku, qty } = {}) {
    const entry = skuIndex.get(String(sku ?? ''));
    if (!entry) {
      return { ok: false, error: 'sku_fuera_de_catalogo', sku: String(sku ?? ''),
        pista: "Call search_part with the technician's words and use a SKU from the result." };
    }
    const q = Number.isFinite(+qty) && +qty >= 1 ? Math.round(+qty) : 1;
    const result = {
      ok: true, sku: entry.pieza.sku, nombre: entry.pieza.nombre, qty: q,
      unidad: entry.pieza.unidad ?? 'pza', confirmada: false,
      requiere_read_back: true,
    };
    store.applyToolResult('add_part_to_report', { sku: entry.pieza.sku, qty: q }, result);
    return result;
  }

  /** Tool renombrada → clave de schema ES de la ficha (las claves no se traducen). */
  const CAMPO = {
    set_problem: 'problema',
    set_diagnosis: 'diagnostico',
    set_solution: 'solucion',
    set_notes: 'notas',
  };

  function setTexto(tool, { texto } = {}) {
    const t = String(texto ?? '').trim();
    if (!t) return { ok: false, error: 'texto_vacio', campo: 'texto' };
    store.applyToolResult(tool, { texto: t }, { ok: true });
    return { ok: true, campo: CAMPO[tool] ?? tool.replace('set_', ''), caracteres: t.length };
  }

  /**
   * Minutos desde el inicio del trabajo (store.workStartedAt).
   * `minutos` es un extra SOLO del mock: recalibra el reloj virtual de trabajo
   * con los minutos que DECLARA el técnico (en una sesión real el tiempo real
   * ya pasó mientras trabajaba; el mock comprime el tiempo de la replay).
   */
  function getTiempo({ minutos } = {}) {
    const t = now();
    if (store.workStartedAt == null) store.startWork(t);
    if (minutos != null && Number.isFinite(+minutos) && +minutos > 0) {
      store.workStartedAt = t - Math.round(+minutos) * 60000;
    }
    const elapsed = Math.max(0, Math.round((t - store.workStartedAt) / 60000));
    const result = { ok: true, minutos: elapsed,
      fuente: minutos != null ? 'declared_by_technician' : 'clock' };
    store.applyToolResult('get_work_time', {}, result);
    return result;
  }

  function enviarReporte() {
    const f = store.final_form;
    const faltantes = [];
    if (!f.problema) faltantes.push('problema');
    if (!f.solucion) faltantes.push('solucion');
    if (!f.piezas.length) faltantes.push('piezas');
    const sinConfirmar = f.piezas.filter((p) => !p.confirmada).map((p) => p.sku);
    if (sinConfirmar.length) faltantes.push(`piezas_sin_confirmar:${sinConfirmar.join(',')}`);
    if (f.tiempo_minutos == null) faltantes.push('tiempo_minutos');
    const result = {
      ok: true, estado: 'enviada',
      resumen: {
        order_id: f.order_id,
        piezas: f.piezas.length,
        piezas_confirmadas: f.piezas.filter((p) => p.confirmada).length,
        tiempo_minutos: f.tiempo_minutos,
        advertencias: faltantes,
      },
    };
    store.applyToolResult('send_report', {}, result);
    return result;
  }

  function ok(result) {
    return result?.ok === false
      ? { ok: false, result }
      : { ok: true, result };
  }

  return { call, catalogSkus: piezas.map((p) => p.sku) };
}

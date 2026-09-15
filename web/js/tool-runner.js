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
 *   set_diagnostico({texto}), set_notas({texto}) — la ficha §6 los tiene pero
 *   las 7 tools públicas del brief no los cubren todavía (decisión D1+).
 */
import { tokenSet, normalizeText, parseQty } from './dialog-act.js';

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
        case 'get_orden': return ok(getOrden(args));
        case 'buscar_pieza': return ok(buscarPieza(args));
        case 'agregar_pieza_a_reporte': return ok(agregarPieza(args));
        case 'set_problema':
        case 'set_diagnostico':
        case 'set_solucion':
        case 'set_notas':
          return ok(setTexto(tool, args));
        case 'get_tiempo_trabajo': return ok(getTiempo(args));
        case 'enviar_reporte': return ok(enviarReporte());
        default:
          return { ok: false, result: { error: `tool_desconocida:${String(tool)}`, tool } };
      }
    } catch (err) {
      return { ok: false, result: { error: 'tool_error', detalle: String(err?.message ?? err) } };
    }
  }

  /* ---------------------------- tools ---------------------------- */

  function getOrden({ orden_id } = {}) {
    const id = String(orden_id ?? '').trim();
    const orden = ordenes.find((o) => String(o.id).toLowerCase() === id.toLowerCase());
    if (!orden) {
      return { ok: false, error: 'orden_no_encontrada', orden_id: id,
        disponibles: ordenes.slice(0, 10).map((o) => o.id) };
    }
    store.applyToolResult('get_orden', { orden_id: id }, orden);
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
    const qTokens = tokenSet(q);
    const qNorm = normalizeText(q);
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
      best = { sku: p.sku, nombre: p.nombre, qty_hint: parseQty(q).qty };
      const sibs = (p.confundible_con ?? []).filter(Boolean);
      if (sibs.length) {
        const sibSku = sibs[0];
        const sib = skuIndex.get(sibSku)?.pieza ?? null;
        confusable_warning = {
          sku: sibSku,
          nombre: sib ? sib.nombre : null,
          mensaje: `«${p.nombre}» se confunde fácilmente con «${sib ? sib.nombre : sibSku}». ` +
            'Pregunta la desambiguación en voz alta antes de dar por buena la pieza.',
        };
      }
    }
    const result = { ok: true, consulta: q, found, best, confusable_warning };
    store.applyToolResult('buscar_pieza', { consulta: q }, result);
    return result;
  }

  function agregarPieza({ sku, qty } = {}) {
    const entry = skuIndex.get(String(sku ?? ''));
    if (!entry) {
      return { ok: false, error: 'sku_fuera_de_catalogo', sku: String(sku ?? ''),
        pista: 'Llama buscar_pieza con las palabras del técnico y usa un SKU del resultado.' };
    }
    const q = Number.isFinite(+qty) && +qty >= 1 ? Math.round(+qty) : 1;
    const result = {
      ok: true, sku: entry.pieza.sku, nombre: entry.pieza.nombre, qty: q,
      unidad: entry.pieza.unidad ?? 'pza', confirmada: false,
      requiere_read_back: true,
    };
    store.applyToolResult('agregar_pieza_a_reporte', { sku: entry.pieza.sku, qty: q }, result);
    return result;
  }

  function setTexto(tool, { texto } = {}) {
    const t = String(texto ?? '').trim();
    if (!t) return { ok: false, error: 'texto_vacio', campo: 'texto' };
    store.applyToolResult(tool, { texto: t }, { ok: true });
    return { ok: true, campo: tool.replace('set_', ''), caracteres: t.length };
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
      fuente: minutos != null ? 'declarado_por_tecnico' : 'reloj' };
    store.applyToolResult('get_tiempo_trabajo', {}, result);
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
    store.applyToolResult('enviar_reporte', {}, result);
    return result;
  }

  function ok(result) {
    return result?.ok === false
      ? { ok: false, result }
      : { ok: true, result };
  }

  return { call, catalogSkus: piezas.map((p) => p.sku) };
}

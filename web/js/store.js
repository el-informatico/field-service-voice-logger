/**
 * store.js — estado de la ficha + traza de auditoría (architecture.md §6).
 * ESM, sin dependencias, DOM-free (browser + Node 22), SIN eventos de DOM:
 * el que notifica a la UI es el session-engine, este módulo es puro estado.
 *
 * final_form (shape §6):
 *   order_id, problema, diagnostico, solucion,
 *   piezas: [{sku, nombre, qty, confirmada}],
 *   tiempo_minutos, notas, estado
 */

const FORM_FIELDS = [
  'order_id', 'problema', 'diagnostico', 'solucion', 'piezas',
  'tiempo_minutos', 'notas', 'estado',
];

/**
 * @param {object} opts
 * @param {string} opts.orderId  id de la orden activa (OT-1xxx)
 * @param {() => number} [opts.now]  reloj inyectable para estampar t_ms en la
 *   auditoría (típicamente el mismo clock del engine). Opcional.
 */
export function createStore({ orderId, now } = {}) {
  const clock = typeof now === 'function' ? now : null;
  let version = 0;
  let auditSeq = 0;
  const audit = [];

  /** @type {object} final_form §6 */
  const final_form = {
    order_id: orderId ?? null,
    problema: '',
    diagnostico: '',
    solucion: '',
    piezas: [],
    tiempo_minutos: null,
    notas: '',
    estado: 'en_proceso',
  };

  /** Marca de inicio del trabajo (ms del reloj de sesión). La controla el
   * driver (el mock la recalibra con los minutos declarados por el técnico). */
  let workStartedAt = null;

  function stamp() {
    return { seq: ++auditSeq, t_ms: clock ? clock() : null };
  }

  function logAudit(action, detail = {}) {
    audit.push({ ...stamp(), action, ...detail });
  }

  /** Aplica un patch top-level al formulario. Devuelve {changed:[campos]}. */
  function updateForm(patch = {}) {
    const changed = [];
    for (const [k, v] of Object.entries(patch)) {
      if (!FORM_FIELDS.includes(k) || k === 'piezas') continue;
      if (JSON.stringify(final_form[k]) !== JSON.stringify(v)) {
        final_form[k] = v;
        changed.push(k);
      }
    }
    if (changed.length) {
      version++;
      logAudit('form_update', { changed });
    }
    return { changed };
  }

  /**
   * Aplica el efecto de un resultado de tool sobre la ficha + auditoría.
   * Devuelve {changed:[campos]}.
   */
  function applyToolResult(tool, args, result) {
    let changed = [];
    switch (tool) {
      case 'get_orden':
        logAudit('orden_cargada', { orden_id: result?.id ?? args?.orden_id });
        break;
      case 'buscar_pieza':
        logAudit('busqueda_pieza', {
          consulta: args?.consulta ?? '',
          best: result?.best?.sku ?? null,
          confundible: result?.confusable_warning?.sku ?? null,
        });
        break;
      case 'agregar_pieza_a_reporte':
        if (result?.ok === false || result?.error) break;
        changed = mergePieza(result.sku, result.nombre, result.qty);
        logAudit('pieza_agregada', { sku: result.sku, qty: result.qty, confirmada: false });
        break;
      case 'set_problema':
        changed = updateForm({ problema: args?.texto ?? '' }).changed;
        logAudit('set_problema', {});
        break;
      case 'set_diagnostico': // interna del mock (no está en las 7 públicas)
        changed = updateForm({ diagnostico: args?.texto ?? '' }).changed;
        logAudit('set_diagnostico', {});
        break;
      case 'set_solucion':
        changed = updateForm({ solucion: args?.texto ?? '' }).changed;
        logAudit('set_solucion', {});
        break;
      case 'set_notas': // interna del mock
        changed = updateForm({ notas: args?.texto ?? '' }).changed;
        logAudit('set_notas', {});
        break;
      case 'get_tiempo_trabajo': {
        const min = result?.minutos ?? null;
        if (min != null && final_form.tiempo_minutos !== min) {
          changed = updateForm({ tiempo_minutos: min }).changed;
        }
        logAudit('tiempo_consultado', { minutos: min });
        break;
      }
      case 'enviar_reporte':
        changed = updateForm({ estado: 'enviada' }).changed;
        logAudit('reporte_enviado', {});
        break;
      default:
        logAudit('tool_desconocida', { tool });
    }
    return { changed };
  }

  function mergePieza(sku, nombre, qty) {
    const existing = final_form.piezas.find((p) => p.sku === sku);
    if (existing) {
      if (existing.qty !== qty) {
        existing.qty = qty;
        version++;
        return { changed: ['piezas'] };
      }
      return { changed: [] };
    }
    final_form.piezas.push({ sku, nombre, qty, confirmada: false });
    version++;
    return { changed: ['piezas'] };
  }

  /**
   * EDICIÓN LIGERA: cambio manual del técnico sobre la ficha antes de enviar.
   * Misma garantía de auditoría que las tools: queda registrado como
   * 'edicion_manual' con su(s) campo(s). `value` para 'piezas' es el arreglo
   * completo ya modificado (se copia en limpio). Devuelve {changed:[campos]}.
   */
  function applyManualEdit(field, value) {
    if (!FORM_FIELDS.includes(field) || field === 'order_id' || field === 'estado') {
      return { changed: [] };
    }
    const next = field === 'piezas' ? structuredCopy(value ?? []) : value;
    if (JSON.stringify(final_form[field]) === JSON.stringify(next)) return { changed: [] };
    final_form[field] = next;
    version++;
    logAudit('edicion_manual', { changed: [field] });
    return { changed: [field] };
  }

  /**
   * Resultado del loop de confirmación hablada.
   * ok=true  → pieza confirmada.
   * ok=false → pieza RECHAZADA por el técnico (se retira de la ficha; el
   *            driver corrige con agregar_pieza_a_reporte de la correcta).
   */
  function markConfirmada(sku, ok) {
    const idx = final_form.piezas.findIndex((p) => p.sku === sku);
    if (idx === -1) return { changed: [] };
    if (ok) {
      if (!final_form.piezas[idx].confirmada) {
        final_form.piezas[idx].confirmada = true;
        version++;
        logAudit('pieza_confirmada', { sku });
        return { changed: ['piezas'] };
      }
      return { changed: [] };
    }
    const [removed] = final_form.piezas.splice(idx, 1);
    version++;
    logAudit('pieza_rechazada', { sku: removed.sku });
    return { changed: ['piezas'] };
  }

  /** Inicio del trabajo (ms del reloj de sesión). */
  function startWork(atMs) {
    workStartedAt = atMs ?? (clock ? clock() : 0);
    logAudit('inicio_trabajo', { at_ms: workStartedAt });
  }

  function snapshot() {
    return {
      version,
      workStartedAt,
      final_form: structuredCopy(final_form),
      audit: structuredCopy(audit),
    };
  }

  /** Ficha final (deep copy) para el artefacto. */
  function exportFinal() {
    return structuredCopy(final_form);
  }

  return {
    final_form,
    get version() { return version; },
    get workStartedAt() { return workStartedAt; },
    set workStartedAt(ms) { workStartedAt = ms; },
    get audit() { return audit; },
    startWork,
    updateForm,
    applyToolResult,
    applyManualEdit,
    markConfirmada,
    snapshot,
    exportFinal,
  };
}

function structuredCopy(x) {
  return JSON.parse(JSON.stringify(x));
}

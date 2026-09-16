/**
 * store.js (incidente) — estado de la ficha de incidente + traza de auditoría
 * (docs/incident-contract.md §2). ESM, sin dependencias, DOM-free (browser +
 * Node 22), SIN eventos de DOM: el que notifica a la UI es el session-engine
 * (compartido, intocado); este módulo es puro estado.
 *
 * Misma superficie de API que web/js/store.js (orden): el engine compartido
 * llama store.startWork / store.applyToolResult / store.markConfirmada /
 * store.exportFinal, y la UI usa final_form / audit / version / workStartedAt
 * / applyManualEdit. Solo cambia la FORMA del final_form.
 *
 * final_form (contrato §2):
 *   incidente_id, resumen, que_paso,
 *   timeline: [{hora: "HH:MM", evento}],
 *   servicios_afectados: [{id, nombre, afectados, confirmado}],
 *   action_items: [string],
 *   severidad: 'baja'|'media'|'alta'|'critica'|null, estado
 */

const FORM_FIELDS = [
  'incidente_id', 'resumen', 'que_paso', 'timeline',
  'servicios_afectados', 'action_items', 'severidad', 'estado',
];

/**
 * @param {object} opts
 * @param {string} opts.incidenteId  id del incidente activo (IC-2xxx)
 * @param {() => number} [opts.now]  reloj inyectable para estampar t_ms en la
 *   auditoría (típicamente el mismo clock del engine). Opcional.
 */
export function createIncidentStore({ incidenteId, now } = {}) {
  const clock = typeof now === 'function' ? now : null;
  let version = 0;
  let auditSeq = 0;
  const audit = [];

  /** @type {object} final_form contrato §2 */
  const final_form = {
    incidente_id: incidenteId ?? null,
    resumen: '',
    que_paso: '',
    timeline: [],
    servicios_afectados: [],
    action_items: [],
    severidad: null,
    estado: 'en_proceso',
  };

  /** Marca de inicio (ms del reloj de sesión). La controla el driver. */
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
      if (!FORM_FIELDS.includes(k) || k === 'timeline' || k === 'servicios_afectados'
        || k === 'action_items') continue; // los arreglos van por sus merges
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
      case 'get_incidente':
        logAudit('incidente_cargado', { incidente_id: result?.id ?? args?.incidente_id });
        break;
      case 'set_resumen':
        changed = updateForm({ resumen: args?.texto ?? '' }).changed;
        logAudit('set_resumen', {});
        break;
      case 'set_que_paso':
        changed = updateForm({ que_paso: args?.texto ?? '' }).changed;
        logAudit('set_que_paso', {});
        break;
      case 'buscar_servicio':
        logAudit('busqueda_servicio', {
          consulta: args?.consulta ?? '',
          best: result?.best?.id ?? null,
          confundible: result?.confusable_warning?.id ?? null,
        });
        break;
      case 'agregar_servicio_afectado':
        if (result?.ok === false || result?.error) break;
        changed = mergeServicio(result.id, result.nombre, result.afectados);
        logAudit('servicio_agregado', { id: result.id, confirmado: false });
        break;
      case 'agregar_evento_timeline': {
        if (result?.ok === false || result?.error) break;
        const hora = result?.hora ?? args?.hora ?? '';
        const evento = result?.evento ?? args?.evento ?? '';
        changed = mergeEvento(hora, evento);
        logAudit('evento_agregado', { hora, evento: String(evento).slice(0, 80) });
        break;
      }
      case 'agregar_action_item':
        if (result?.ok === false || result?.error) break;
        changed = addActionItem(result.descripcion ?? args?.descripcion ?? '');
        logAudit('action_item_agregado', {});
        break;
      case 'set_severidad':
        if (result?.ok === false || result?.error) break;
        changed = updateForm({ severidad: args?.severidad ?? null }).changed;
        logAudit('severidad_fijada', { severidad: args?.severidad ?? null });
        break;
      /* -------- internals: solo las usa el mock-agent (no van en §5) ------- */
      case 'confirmar_servicio': {
        const idx = final_form.servicios_afectados.findIndex((s) => s.id === args?.id);
        if (idx !== -1 && !final_form.servicios_afectados[idx].confirmado) {
          final_form.servicios_afectados[idx].confirmado = true;
          version++;
          changed = ['servicios_afectados'];
        }
        logAudit('servicio_confirmado', { id: args?.id });
        break;
      }
      case 'quitar_servicio': {
        const idx = final_form.servicios_afectados.findIndex((s) => s.id === args?.id);
        if (idx !== -1) {
          final_form.servicios_afectados.splice(idx, 1);
          version++;
          changed = ['servicios_afectados'];
        }
        logAudit('servicio_rechazado', { id: args?.id });
        break;
      }
      case 'corregir_hora': {
        const de = String(args?.de ?? '');
        const a = String(args?.a ?? '');
        const row = final_form.timeline.find((e) => e.hora === de);
        if (row && a && row.hora !== a) {
          row.hora = a;
          version++;
          changed = ['timeline'];
        }
        logAudit('hora_corregida', { de, a });
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

  function mergeServicio(id, nombre, afectados) {
    const existing = final_form.servicios_afectados.find((s) => s.id === id);
    if (existing) {
      if (existing.afectados !== afectados) {
        existing.afectados = afectados;
        version++;
        return { changed: ['servicios_afectados'] };
      }
      return { changed: [] };
    }
    final_form.servicios_afectados.push({ id, nombre, afectados, confirmado: false });
    version++;
    return { changed: ['servicios_afectados'] };
  }

  function mergeEvento(hora, evento) {
    const existing = final_form.timeline.find((e) => e.hora === hora);
    if (existing) {
      if (existing.evento !== evento) {
        existing.evento = evento;
        version++;
        return { changed: ['timeline'] };
      }
      return { changed: [] };
    }
    final_form.timeline.push({ hora, evento });
    version++;
    return { changed: ['timeline'] };
  }

  function addActionItem(descripcion) {
    const t = String(descripcion ?? '').trim();
    if (!t || final_form.action_items.includes(t)) return { changed: [] };
    final_form.action_items.push(t);
    version++;
    return { changed: ['action_items'] };
  }

  /**
   * EDICIÓN LIGERA: cambio manual del operador sobre la ficha antes de enviar.
   * Misma garantía de auditoría que las tools: queda registrado como
   * 'edicion_manual' con su(s) campo(s). Para 'timeline', 'servicios_afectados'
   * y 'action_items' el `value` es el arreglo completo ya modificado.
   * Devuelve {changed:[campos]}.
   */
  function applyManualEdit(field, value) {
    if (!FORM_FIELDS.includes(field) || field === 'incidente_id' || field === 'estado') {
      return { changed: [] };
    }
    const isArray = field === 'timeline' || field === 'servicios_afectados' || field === 'action_items';
    const next = isArray ? structuredCopy(value ?? []) : value;
    if (JSON.stringify(final_form[field]) === JSON.stringify(next)) return { changed: [] };
    final_form[field] = next;
    version++;
    logAudit('edicion_manual', { changed: [field] });
    return { changed: [field] };
  }

  /**
   * Resultado del loop de confirmación hablada (servicios).
   * ok=true  → servicio confirmado.
   * ok=false → servicio RECHAZADO por el operador (se retira de la ficha; el
   *            driver corrige con agregar_servicio_afectado del correcto).
   */
  function markConfirmada(id, ok) {
    const idx = final_form.servicios_afectados.findIndex((s) => s.id === id);
    if (idx === -1) return { changed: [] };
    if (ok) {
      if (!final_form.servicios_afectados[idx].confirmado) {
        final_form.servicios_afectados[idx].confirmado = true;
        version++;
        logAudit('servicio_confirmado', { id });
        return { changed: ['servicios_afectados'] };
      }
      return { changed: [] };
    }
    const [removed] = final_form.servicios_afectados.splice(idx, 1);
    version++;
    logAudit('servicio_rechazado', { id: removed.id });
    return { changed: ['servicios_afectados'] };
  }

  /** Inicio del registro (ms del reloj de sesión). */
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

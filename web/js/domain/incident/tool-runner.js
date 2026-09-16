/**
 * tool-runner.js (incidente) — IMPLEMENTACIÓN cliente de las 9 tools contra
 * data/ (docs/incident-contract.md §5). ESM, sin dependencias, DOM-free
 * (browser + Node 22).
 *
 * `createIncidentToolRunner({incidentes, servicios, store, clock})` devuelve
 * `{ call(tool, args) }` donde call devuelve SIEMPRE algo JSON-serializable
 * `{ok, result}` (el protocolo real manda `result` como string JSON vía
 * tool.result). Las mutaciones de la ficha pasan TODAS por
 * store.applyToolResult — nada escribe directo. Espejo de web/js/tool-runner.js.
 *
 * Extras internos (solo los usa el mock-agent; NO van en
 * buildIncidentToolDefinitions):
 *   confirmar_servicio({id}), quitar_servicio({id}), corregir_hora({de, a}) —
 *   el session-engine compartido solo aplica markConfirmada para field='pieza'
 *   del dominio orden, así que el loop de confirmación del dominio incidente
 *   viaja por tools internas (misma auditoría, mismo artefacto).
 */
import { scoreServicios, esHoraValida, canonHora } from './dialog.js';
import { SEVERIDADES } from './tools.js';

export function createIncidentToolRunner({ incidentes = [], servicios = [], store } = {}) {
  if (!store) throw new Error('createIncidentToolRunner: falta store');
  const servicioIndex = new Map(servicios.map((s, i) => [s.id, { servicio: s, idx: i }]));

  async function call(tool, args = {}) {
    try {
      switch (tool) {
        case 'get_incidente': return ok(getIncidente(args));
        case 'set_resumen':
        case 'set_que_paso':
          return ok(setTexto(tool, args));
        case 'buscar_servicio': return ok(buscarServicio(args));
        case 'agregar_servicio_afectado': return ok(agregarServicio(args));
        case 'agregar_evento_timeline': return ok(agregarEvento(args));
        case 'agregar_action_item': return ok(agregarActionItem(args));
        case 'set_severidad': return ok(setSeveridad(args));
        case 'confirmar_servicio':
        case 'quitar_servicio':
        case 'corregir_hora':
          return ok(interno(tool, args));
        case 'enviar_reporte': return ok(enviarReporte());
        default:
          return { ok: false, result: { error: `tool_desconocida:${String(tool)}`, tool } };
      }
    } catch (err) {
      return { ok: false, result: { error: 'tool_error', detalle: String(err?.message ?? err) } };
    }
  }

  /* ---------------------------- tools ---------------------------- */

  function getIncidente({ incidente_id } = {}) {
    const activo = String(store.final_form.incidente_id ?? '').trim();
    let id = String(incidente_id ?? '').trim();
    let incidente = incidentes.find((o) => String(o.id).toLowerCase() === id.toLowerCase());
    // Sin id (o id = el activo dicho a medias): devolver el incidente ACTIVO
    // de la sesión — la app lo asigna al abrir; el operador no tiene que dictarlo.
    if (!incidente && (!id || id.toLowerCase() === activo.toLowerCase())) {
      incidente = incidentes.find((o) => String(o.id).toLowerCase() === activo.toLowerCase());
      if (incidente) id = incidente.id;
    }
    if (!incidente) {
      return {
        ok: false, error: 'incidente_no_encontrado', incidente_id: id,
        disponibles: incidentes.slice(0, 10).map((o) => o.id),
      };
    }
    store.applyToolResult('get_incidente', { incidente_id: id }, incidente);
    return { ok: true, incidente };
  }

  /**
   * Búsqueda tolerante (mismo algoritmo que buscar_pieza del dominio orden):
   * normaliza, puntúa por solapamiento de tokens contra nombre + alias + id,
   * empate → primero del catálogo. Siempre reporta el par confundible del
   * best como advertencia — es lo que dispara el read-back de desambiguación.
   */
  function buscarServicio({ consulta } = {}) {
    const q = String(consulta ?? '');
    const scored = scoreServicios(q, servicios);
    const found = scored.slice(0, 3).map((s) => ({ id: s.servicio.id, nombre: s.servicio.nombre, score: s.score }));
    const bestScored = scored.find((s) => s.score >= 2) ?? null;

    let best = null;
    let confusable_warning = null;
    if (bestScored) {
      const s = bestScored.servicio;
      best = { id: s.id, nombre: s.nombre };
      const sibs = (s.confundible_con ?? []).filter(Boolean);
      if (sibs.length) {
        const sibId = sibs[0];
        const sib = servicioIndex.get(sibId)?.servicio ?? null;
        confusable_warning = {
          id: sibId,
          nombre: sib ? sib.nombre : null,
          mensaje: `«${s.nombre}» se confunde fácilmente con «${sib ? sib.nombre : sibId}». ` +
            'Pregunta la desambiguación en voz alta nombrando AMBOS antes de dar por bueno el servicio.',
        };
      }
    }
    const result = { ok: true, consulta: q, found, best, confusable_warning };
    store.applyToolResult('buscar_servicio', { consulta: q }, result);
    return result;
  }

  function agregarServicio({ id, afectados } = {}) {
    const entry = servicioIndex.get(String(id ?? ''));
    if (!entry) {
      return {
        ok: false, error: 'id_fuera_de_catalogo', id: String(id ?? ''),
        pista: 'Llama buscar_servicio con las palabras del operador y usa un id del resultado.',
      };
    }
    const n = afectados != null && Number.isFinite(+afectados) && +afectados >= 0
      ? Math.round(+afectados)
      : null;
    const result = {
      ok: true, id: entry.servicio.id, nombre: entry.servicio.nombre, afectados: n,
      confirmado: false, requiere_read_back: true,
    };
    store.applyToolResult('agregar_servicio_afectado', { id: entry.servicio.id, afectados: n }, result);
    return result;
  }

  function agregarEvento({ hora, evento } = {}) {
    const ev = String(evento ?? '').trim();
    if (!ev) return { ok: false, error: 'evento_vacio', campo: 'evento' };
    if (!esHoraValida(hora)) {
      return {
        ok: false, error: 'hora_invalida', hora: String(hora ?? ''),
        pista: 'Hora en formato 24 h "H:MM" u "HH:MM" (p. ej. "9:20").',
      };
    }
    const canon = canonHora(hora);
    const result = { ok: true, hora: canon, evento: ev, requiere_read_back: true };
    store.applyToolResult('agregar_evento_timeline', { hora: canon, evento: ev }, result);
    return result;
  }

  function agregarActionItem({ descripcion } = {}) {
    const d = String(descripcion ?? '').trim();
    if (!d) return { ok: false, error: 'descripcion_vacia', campo: 'descripcion' };
    const result = { ok: true, descripcion: d };
    store.applyToolResult('agregar_action_item', { descripcion: d }, result);
    return result;
  }

  function setSeveridad({ severidad } = {}) {
    const s = String(severidad ?? '').trim().toLowerCase();
    if (!SEVERIDADES.includes(s)) {
      return {
        ok: false, error: 'severidad_invalida', severidad: String(severidad ?? ''),
        pista: `Severidad del enum: ${SEVERIDADES.join(', ')}.`,
      };
    }
    const result = { ok: true, severidad: s, requiere_read_back: true };
    store.applyToolResult('set_severidad', { severidad: s }, result);
    return result;
  }

  /** Tools internas del mock (confirmación del loop hablado y correcciones). */
  function interno(tool, args = {}) {
    if (tool === 'corregir_hora') {
      if (!esHoraValida(args.de) || !esHoraValida(args.a)) {
        return { ok: false, error: 'hora_invalida', de: args.de, a: args.a };
      }
      const result = { ok: true, de: canonHora(args.de), a: canonHora(args.a) };
      store.applyToolResult('corregir_hora', { de: result.de, a: result.a }, result);
      return result;
    }
    const id = String(args?.id ?? '');
    if (!servicioIndex.has(id)) return { ok: false, error: 'id_fuera_de_catalogo', id };
    const result = { ok: true, id };
    store.applyToolResult(tool, { id }, result);
    return result;
  }

  function setTexto(tool, { texto } = {}) {
    const t = String(texto ?? '').trim();
    if (!t) return { ok: false, error: 'texto_vacio', campo: 'texto' };
    store.applyToolResult(tool, { texto: t }, { ok: true });
    return { ok: true, campo: tool.replace('set_', ''), caracteres: t.length };
  }

  function enviarReporte() {
    const f = store.final_form;
    const faltantes = [];
    if (!f.que_paso) faltantes.push('que_paso');
    if (!f.resumen) faltantes.push('resumen');
    if (!f.timeline.length) faltantes.push('timeline');
    if (!f.servicios_afectados.length) faltantes.push('servicios_afectados');
    const sinConfirmar = f.servicios_afectados.filter((s) => !s.confirmado).map((s) => s.id);
    if (sinConfirmar.length) faltantes.push(`servicios_sin_confirmar:${sinConfirmar.join(',')}`);
    if (!f.severidad) faltantes.push('severidad');
    const result = {
      ok: true, estado: 'enviada',
      resumen: {
        incidente_id: f.incidente_id,
        eventos: f.timeline.length,
        servicios: f.servicios_afectados.length,
        servicios_confirmados: f.servicios_afectados.filter((s) => s.confirmado).length,
        action_items: f.action_items.length,
        severidad: f.severidad,
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

  return { call, catalogIds: servicios.map((s) => s.id) };
}

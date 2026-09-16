/**
 * tools.js (incidente) — DEFINICIONES de las 9 function-tools del dominio
 * INCIDENTE (docs/incident-contract.md §5). ESM, sin dependencias, DOM-free.
 *
 * Mismo formato y estilo que web/js/tools.js (orden de trabajo): van dentro de
 * `session.update`, el agente (LLM real) las lee para decidir CUÁNDO llamar y
 * las implementa tool-runner.js (dominio incidente) en el cliente.
 *
 * El `enum` del parámetro `id` de agregar_servicio_afectado se construye EN
 * TIEMPO DE SESIÓN desde data/servicios.json: guarda a nivel schema contra
 * servicios fuera de catálogo (el LLM no puede inventar ids).
 */

/** Severidades válidas del contrato §5. */
export const SEVERIDADES = ['baja', 'media', 'alta', 'critica'];

/** Regex de hora del timeline (contrato §5): "9:20" y "09:20" son válidas. */
export const HORA_PATTERN = '^\\d{1,2}:\\d{2}$';

/**
 * @param {string[]} servicioIds ids válidos del catálogo (data/servicios.json).
 *   Si viene vacío se omite el `enum` (tool-runner rechazará el id igualmente).
 * @returns {Array<object>} definiciones listas para `session.update.session.tools`
 */
export function buildIncidentToolDefinitions(servicioIds = []) {
  const ids = Array.isArray(servicioIds) ? servicioIds.filter(Boolean) : [];
  const idSchema = ids.length
    ? {
      type: 'string',
      enum: ids,
      description: 'ID exacto del catálogo (respetado por el enum: no inventes ids). Formato SRV-XXX.',
    }
    : { type: 'string', description: 'ID exacto del catálogo de servicios.' };

  return [
    {
      type: 'function',
      name: 'get_incidente',
      description:
        'Carga el incidente activo y devuelve todos sus datos (cliente, sitio, equipo, reporte inicial, categoría). ' +
        'Llámala UNA vez al inicio de la sesión: el incidente YA está asignado por la app, no hace falta dictar el número.',
      parameters: {
        type: 'object',
        properties: {
          incidente_id: {
            type: 'string',
            description: 'OPCIONAL — si se omite (o el técnico no lo dice), devuelve el incidente ACTIVO de la sesión. Formato IC-2xxx.',
          },
        },
        required: [],
      },
      execution_mode: 'interactive',
    },
    {
      type: 'function',
      name: 'set_resumen',
      description:
        'Fija el resumen del incidente en UNA sola línea (qué pasó, servicio(s) afectado(s) y severidad). ' +
        'Es el encabezado de la ficha: breve, sin jerga innecesaria, pero fiel a lo que dijo el operador.',
      parameters: {
        type: 'object',
        properties: {
          texto: {
            type: 'string',
            description: 'Una línea que resuma el incidente (p. ej. "Caída del portal por saturación en el rack; servicio web de producción afectado, severidad alta").',
          },
        },
        required: ['texto'],
      },
      execution_mode: 'interactive',
    },
    {
      type: 'function',
      name: 'set_que_paso',
      description:
        'Fija la narrativa "qué pasó" con las palabras DEL OPERADOR (el dictado post-visita). ' +
        'NO parafrasees, NO resumas, NO traduzcas su jerga: es evidencia textual del incidente.',
      parameters: {
        type: 'object',
        properties: {
          texto: {
            type: 'string',
            description: 'Texto del operador narrando lo que pasó (primera persona, verbatim o casi).',
          },
        },
        required: ['texto'],
      },
      execution_mode: 'interactive',
    },
    {
      type: 'function',
      name: 'buscar_servicio',
      description:
        'Busca un servicio del catálogo por nombre hablado, jerga o alias (búsqueda tolerante: minúsculas, sin acentos, sin plurales). ' +
        'Llámala SIEMPRE que el operador mencione un servicio o equipo afectado ANTES de agregarlo. ' +
        'La respuesta incluye el mejor candidato (best), hasta 3 alternativas (found) y una advertencia (confusable_warning) ' +
        'si el mejor candidato tiene un par confundible en catálogo (p. ej. web de producción vs web de staging): ' +
        'en ese caso debes preguntar la desambiguación en voz alta nombrando AMBOS candidatos antes de dar por bueno el servicio.',
      parameters: {
        type: 'object',
        properties: {
          consulta: {
            type: 'string',
            description: 'Lo que dijo el operador, tal cual (p. ej. "se cayó el servidor web de producción"). No limpies ni traduzcas.',
          },
        },
        required: ['consulta'],
      },
      execution_mode: 'interactive',
    },
    {
      type: 'function',
      name: 'agregar_servicio_afectado',
      description:
        'Agrega un servicio afectado a la ficha. Solo acepta ids del enum (los devueltos por buscar_servicio). ' +
        'El servicio queda SIN confirmar (confirmado=false): la confirmación llega únicamente del read-back hablado — ' +
        'debes leer en voz alta el nombre del servicio (y cuántos afectados, si se dijo) y esperar el "sí" del operador.',
      parameters: {
        type: 'object',
        properties: {
          id: idSchema,
          afectados: {
            type: 'integer',
            minimum: 0,
            description: 'OPCIONAL — número de usuarios/equipos afectados que declaró el operador. Omitir si no se dijo.',
          },
        },
        required: ['id'],
      },
      execution_mode: 'interactive',
    },
    {
      type: 'function',
      name: 'agregar_evento_timeline',
      description:
        'Agrega un evento al timeline del incidente con su hora. La hora se valida con el patrón "H:MM" u "HH:MM" ' +
        '(24 h). SIEMPRE haz read-back de la hora en voz alta tras agregar ("a las nueve veinte, ¿correcto?"): ' +
        'las horas mal oídas son el error más caro de un reporte.',
      parameters: {
        type: 'object',
        properties: {
          hora: {
            type: 'string',
            pattern: HORA_PATTERN,
            description: 'Hora del evento en formato 24 h, "9:20" u "09:20" (dígitos y dos puntos, nada más).',
          },
          evento: {
            type: 'string',
            description: 'Qué pasó a esa hora, con las palabras del operador (p. ej. "se cayó el portal y empezaron los tickets").',
          },
        },
        required: ['hora', 'evento'],
      },
      execution_mode: 'interactive',
    },
    {
      type: 'function',
      name: 'agregar_action_item',
      description:
        'Agrega un pendiente / action item a la ficha (lo que queda por hacer tras el incidente: seguimientos, ' +
        'avisos, cambios pendientes, compras). Un llamado por ítem.',
      parameters: {
        type: 'object',
        properties: {
          descripcion: {
            type: 'string',
            description: 'El pendiente en una frase (p. ej. "avisar al jefe de TI cuando se recupere el enlace").',
          },
        },
        required: ['descripcion'],
      },
      execution_mode: 'interactive',
    },
    {
      type: 'function',
      name: 'set_severidad',
      description:
        'Fija la severidad del incidente (baja | media | alta | critica). SOLO con el valor que declaró el operador. ' +
        'Esta tool SIEMPRE dispara read-back de confirmación en voz alta: "anoto severidad alta, ¿correcto?".',
      parameters: {
        type: 'object',
        properties: {
          severidad: {
            type: 'string',
            enum: SEVERIDADES,
            description: 'Severidad declarada por el operador (enum estricto: baja, media, alta o critica).',
          },
        },
        required: ['severidad'],
      },
      execution_mode: 'interactive',
    },
    {
      type: 'function',
      name: 'enviar_reporte',
      description:
        'CIERRA y envía la ficha del incidente (estado=enviada). Llámala solo cuando el operador lo pida ("mándalo", "ya está") ' +
        'Y cuando resumen, qué pasó, timeline, servicios (todos confirmados) y severidad estén capturados; si falta algo, pregúntalo antes de enviar.',
      parameters: { type: 'object', properties: {} },
      execution_mode: 'interactive',
    },
  ];
}

/** Nombres de las 9 tools públicas (para validación en tool-runner/smoke). */
export const INCIDENT_TOOL_NAMES = [
  'get_incidente', 'set_resumen', 'set_que_paso', 'buscar_servicio',
  'agregar_servicio_afectado', 'agregar_evento_timeline',
  'agregar_action_item', 'set_severidad', 'enviar_reporte',
];

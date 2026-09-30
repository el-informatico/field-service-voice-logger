/**
 * tools.js (incidente) — DEFINICIONES de las 9 function-tools del dominio
 * INCIDENTE (docs/incident-contract.md §5). ESM, sin dependencias, DOM-free.
 *
 * Mismo formato y estilo que web/js/tools.js (orden de trabajo): van dentro de
 * `session.update`, el agente (LLM real) las lee para decidir CUANDO llamar y
 * las implementa tool-runner.js (dominio incidente) en el cliente.
 *
 * El `enum` del parametro `id` de add_affected_service se construye EN
 * TIEMPO DE SESION desde data/servicios.json: guarda a nivel schema contra
 * servicios fuera de catalogo (el LLM no puede inventar ids).
 */

/** Severidades validas del contrato §5. */
export const SEVERIDADES = ['low', 'medium', 'high', 'critical'];

/** Regex de hora del timeline (contrato §5): "9:20" y "09:20" son validas. */
export const HORA_PATTERN = '^\\d{1,2}:\\d{2}$';

/**
 * @param {string[]} servicioIds ids validos del catalogo (data/servicios.json).
 *   Si viene vacio se omite el `enum` (tool-runner rechazara el id igualmente).
 * @returns {Array<object>} definiciones listas para `session.update.session.tools`
 */
export function buildIncidentToolDefinitions(servicioIds = []) {
  const ids = Array.isArray(servicioIds) ? servicioIds.filter(Boolean) : [];
  const idSchema = ids.length
    ? {
      type: 'string',
      enum: ids,
      description: 'Exact catalog ID (enforced by the enum: do not invent ids). Format SRV-XXX.',
    }
    : { type: 'string', description: 'Exact ID from the service catalog.' };

  return [
    {
      type: 'function',
      name: 'get_incident',
      description:
        'Loads the active incident and returns all of its data (customer, site, equipment, initial report, category). ' +
        'Call it ONCE at the start of the session: the incident is ALREADY assigned by the app, the operator does not need to dictate the number.',
      parameters: {
        type: 'object',
        properties: {
          incidente_id: {
            type: 'string',
            description: 'OPTIONAL — if omitted (or the technician does not say it), returns the ACTIVE incident of the session. Format IC-2xxx.',
          },
        },
        required: [],
      },
      execution_mode: 'interactive',
    },
    {
      type: 'function',
      name: 'set_summary',
      description:
        'Sets the incident summary in ONE single line (what happened, affected service(s) and severity). ' +
        'It is the header of the report card: brief, no unnecessary jargon, but faithful to what the operator said.',
      parameters: {
        type: 'object',
        properties: {
          texto: {
            type: 'string',
            description: 'One line summarizing the incident (e.g. "Online store down from a saturated rack; production web server affected, high severity").',
          },
        },
        required: ['texto'],
      },
      execution_mode: 'interactive',
    },
    {
      type: 'function',
      name: 'set_what_happened',
      description:
        'Sets the "what happened" narrative with THE OPERATOR\'s words (the post-visit dictation). ' +
        'Do NOT paraphrase, do NOT summarize, do NOT translate their jargon: it is textual evidence of the incident.',
      parameters: {
        type: 'object',
        properties: {
          texto: {
            type: 'string',
            description: 'The operator\'s text narrating what happened (first person, verbatim or close).',
          },
        },
        required: ['texto'],
      },
      execution_mode: 'interactive',
    },
    {
      type: 'function',
      name: 'search_service',
      description:
        'Searches a catalog service by spoken name, jargon or alias (tolerant search: lowercase, accent-free, no plurals). ' +
        'Call it EVERY time the operator mentions an affected service or piece of equipment BEFORE adding it. ' +
        'The response includes the best candidate (best), up to 3 alternatives (found) and a warning (confusable_warning) ' +
        'if the best candidate has a confusable pair in the catalog (e.g. production web vs staging web): ' +
        'in that case you must ask the disambiguation out loud naming BOTH candidates before accepting the service.',
      parameters: {
        type: 'object',
        properties: {
          consulta: {
            type: 'string',
            description: 'What the operator said, verbatim (e.g. "the production web server went down"). Do not clean up or translate it.',
          },
        },
        required: ['consulta'],
      },
      execution_mode: 'interactive',
    },
    {
      type: 'function',
      name: 'add_affected_service',
      description:
        'Adds an affected service to the report card. Only accepts ids from the enum (those returned by search_service). ' +
        'The service stays UNCONFIRMED (confirmado=false): confirmation comes only from the spoken read-back — ' +
        'you must read the service name out loud (and how many affected, if stated) and wait for the operator\'s "yes".',
      parameters: {
        type: 'object',
        properties: {
          id: idSchema,
          afectados: {
            type: 'integer',
            minimum: 0,
            description: 'OPTIONAL — number of users/devices affected as stated by the operator. Omit if not said.',
          },
        },
        required: ['id'],
      },
      execution_mode: 'interactive',
    },
    {
      type: 'function',
      name: 'add_timeline_event',
      description:
        'Adds an event to the incident timeline with its time. The time is validated against the "H:MM" or "HH:MM" ' +
        'pattern (24 h). ALWAYS read the time back out loud after adding ("at nine twenty, correct?"): ' +
        'misheard times are the most expensive error in a report.',
      parameters: {
        type: 'object',
        properties: {
          hora: {
            type: 'string',
            pattern: HORA_PATTERN,
            description: 'Event time in 24-hour format, "9:20" or "09:20" (digits and a colon, nothing else).',
          },
          evento: {
            type: 'string',
            description: 'What happened at that time, in the operator\'s words (e.g. "the portal went down and the tickets started").',
          },
        },
        required: ['hora', 'evento'],
      },
      execution_mode: 'interactive',
    },
    {
      type: 'function',
      name: 'add_action_item',
      description:
        'Adds a pending item / action item to the report card (what remains to be done after the incident: follow-ups, ' +
        'notifications, pending changes, purchases). One call per item.',
      parameters: {
        type: 'object',
        properties: {
          descripcion: {
            type: 'string',
            description: 'The pending item in one sentence (e.g. "tell the IT lead once the link is back up").',
          },
        },
        required: ['descripcion'],
      },
      execution_mode: 'interactive',
    },
    {
      type: 'function',
      name: 'set_severity',
      description:
        'Sets the incident severity (low | medium | high | critical). ONLY with the value the operator declared. ' +
        'This tool ALWAYS triggers an out-loud confirmation read-back: "noting high severity, correct?".',
      parameters: {
        type: 'object',
        properties: {
          severidad: {
            type: 'string',
            enum: SEVERIDADES,
            description: 'Severity as declared by the operator (strict enum: low, medium, high or critical).',
          },
        },
        required: ['severidad'],
      },
      execution_mode: 'interactive',
    },
    {
      type: 'function',
      name: 'send_report',
      description:
        'CLOSES and sends the incident report card (state=sent). Call it only when the operator asks for it ("send it", "that\'s all") ' +
        'AND when summary, what happened, timeline, services (all confirmed) and severity are captured; if anything is missing, ask before sending.',
      parameters: { type: 'object', properties: {} },
      execution_mode: 'interactive',
    },
  ];
}

/** Nombres de las 9 tools publicas (para validacion en tool-runner/smoke). */
export const INCIDENT_TOOL_NAMES = [
  'get_incident', 'set_summary', 'set_what_happened', 'search_service',
  'add_affected_service', 'add_timeline_event',
  'add_action_item', 'set_severity', 'send_report',
];

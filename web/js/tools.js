/**
 * tools.js — DEFINICIONES de las 7 function-tools del lado cliente
 * (architecture.md §7). ESM, sin dependencias, DOM-free.
 *
 * Estas definiciones van dentro de `session.update` (ver ws-agent.js y
 * docs/research/assemblyai-notes.md §Tools): el agente (LLM real) las lee para
 * decidir CUÁNDO llamar; las implementa tool-runner.js en el cliente. El flujo
 * en el protocolo real es `tool.call` → cliente ejecuta → `tool.result` con el
 * result como string JSON (enviado cuando el último evento recibido es
 * `reply.done`).
 *
 * El `enum` del parámetro `sku` de add_part_to_report se construye EN
 * TIEMPO DE SESIÓN desde data/piezas.json: es la guarda a nivel schema contra
 * piezas confundibles (el LLM no puede inventar un SKU fuera de catálogo).
 *
 * Nombres de tools renombrados ES→EN (mapa canónico; ver git log): las
 * descripciones quedaron en EN imitando el estilo del dominio incidente
 * (web/js/domain/incident/tools.js). Los NOMBRES de parámetros (orden_id,
 * consulta, sku, qty, texto, minutos) no se traducen.
 */

/**
 * @param {string[]} catalogSkus SKUs válidos del catálogo (data/piezas.json).
 *   Si viene vacío se omite el `enum` (y add_part_to_report quedará sin
 *   guarda — tool-runner rechazará el SKU igualmente).
 * @returns {Array<object>} definiciones listas para `session.update.session.tools`
 */
export function buildToolDefinitions(catalogSkus = []) {
  const skus = Array.isArray(catalogSkus) ? catalogSkus.filter(Boolean) : [];
  const skuSchema = skus.length
    ? {
      type: 'string',
      enum: skus,
      description: 'Exact catalog ID (enforced by the enum: do not invent ids). Format AAA-000-X.',
    }
    : { type: 'string', description: 'Exact catalog ID.' };

  return [
    {
      type: 'function',
      name: 'get_order',
      description:
        'Loads the active work order and returns all of its data (customer, site, equipment, reported problem). ' +
        'Call it ONCE at the start of the session, when the technician says which order they are working on, ' +
        'to know the context before interviewing.',
      parameters: {
        type: 'object',
        properties: {
          orden_id: {
            type: 'string',
            description: 'OPTIONAL — if omitted (or the technician does not say the number), returns the ACTIVE order of the session, already assigned by the app. Format OT-1xxx.',
          },
        },
        required: [],
      },
      execution_mode: 'interactive',
    },
    {
      type: 'function',
      name: 'search_part',
      description:
        'Searches a catalog part by spoken name, jargon or alias (tolerant search: lowercase, accent-free, no plurals). ' +
        'Call it EVERY time the technician mentions a part or component BEFORE adding it to the report. ' +
        'The response includes the best candidate (best), up to 3 alternatives (found) and a warning (confusable_warning) ' +
        'if the best candidate has a confusable pair in the catalog (e.g. valve 3/4" vs 3/8"): in that case you must ' +
        'ask the disambiguation out loud naming BOTH candidates before accepting the part.',
      parameters: {
        type: 'object',
        properties: {
          consulta: {
            type: 'string',
            description: 'What the technician said, verbatim (e.g. "the three-quarters valve that drips"). Do not clean up or translate it.',
          },
        },
        required: ['consulta'],
      },
      execution_mode: 'interactive',
    },
    {
      type: 'function',
      name: 'add_part_to_report',
      description:
        'Adds (or accumulates) a part with its quantity to the report card. Only accepts ids from the enum (those returned by search_part). ' +
        'The part stays UNCONFIRMED (confirmada=false): confirmation comes only from the spoken read-back — ' +
        'you must read part AND quantity out loud and wait for the technician\'s "yes" before considering the data good.',
      parameters: {
        type: 'object',
        properties: {
          sku: skuSchema,
          qty: {
            type: 'integer',
            minimum: 1,
            description: 'Quantity of parts as stated by the technician (default 1). Confirm it in the read-back too.',
          },
        },
        required: ['sku', 'qty'],
      },
      execution_mode: 'interactive',
    },
    {
      type: 'function',
      name: 'set_problem',
      description:
        'Sets the "problem" field of the report card with THE TECHNICIAN\'s words (what failure the equipment reports now). ' +
        'Do NOT paraphrase, do NOT summarize, do NOT use technical vocabulary the technician did not use: it is textual evidence.',
      parameters: {
        type: 'object',
        properties: {
          texto: {
            type: 'string',
            description: 'The technician\'s text describing the problem (first person, verbatim or close).',
          },
        },
        required: ['texto'],
      },
      execution_mode: 'interactive',
    },
    {
      type: 'function',
      name: 'set_solution',
      description:
        'Sets the "solution" field of the report card with THE TECHNICIAN\'s narration (what they did to fix it and how the equipment ended up). ' +
        'Do not paraphrase or add steps they did not mention.',
      parameters: {
        type: 'object',
        properties: {
          texto: {
            type: 'string',
            description: 'The technician\'s text narrating the solution and the final outcome.',
          },
        },
        required: ['texto'],
      },
      execution_mode: 'interactive',
    },
    {
      type: 'function',
      name: 'get_work_time',
      description:
        'Registers/queries the work time. Pass {minutos: N} with the minutes the technician DECLARED ' +
        '(e.g. "about fifty minutes" → 50) — that way the real job time is recorded, not the time of this call. ' +
        'Without arguments it returns the minutes elapsed in the session. Call it before send_report.',
      parameters: {
        type: 'object',
        properties: {
          minutos: {
            type: 'integer',
            description: 'Minutes as declared by the technician (just the number, e.g. 50). Omit = query the elapsed time.',
          },
        },
        required: [],
      },
      execution_mode: 'interactive',
    },
    {
      type: 'function',
      name: 'send_report',
      description:
        'CLOSES and sends the work-order report card (state=sent). Call it only when the technician asks for it ("send it", "that\'s all") ' +
        'AND when problem, solution, parts (all confirmed) and time are captured; if anything is missing, ask before sending.',
      parameters: { type: 'object', properties: {} },
      execution_mode: 'interactive',
    },
  ];
}

/** Nombres de las 7 tools públicas (para validación en tool-runner/engine). */
export const TOOL_NAMES = [
  'get_order', 'search_part', 'add_part_to_report', 'set_problem',
  'set_solution', 'get_work_time', 'send_report',
];

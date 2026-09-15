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
 * El `enum` del parámetro `sku` de agregar_pieza_a_reporte se construye EN
 * TIEMPO DE SESIÓN desde data/piezas.json: es la guarda a nivel schema contra
 * piezas confundibles (el LLM no puede inventar un SKU fuera de catálogo).
 */

/**
 * @param {string[]} catalogSkus SKUs válidos del catálogo (data/piezas.json).
 *   Si viene vacío se omite el `enum` (y agregar_pieza quedará sin guarda —
 *   tool-runner rechazará el SKU igualmente).
 * @returns {Array<object>} definiciones listas para `session.update.session.tools`
 */
export function buildToolDefinitions(catalogSkus = []) {
  const skus = Array.isArray(catalogSkus) ? catalogSkus.filter(Boolean) : [];
  const skuSchema = skus.length
    ? {
      type: 'string',
      enum: skus,
      description: 'SKU exacto del catálogo (respetado por el enum: no inventes SKUs).',
    }
    : { type: 'string', description: 'SKU exacto del catálogo.' };

  return [
    {
      type: 'function',
      name: 'get_orden',
      description:
        'Carga la orden de trabajo activa y devuelve todos sus datos (cliente, sitio, equipo, problema reportado). ' +
        'Llámala UNA vez al inicio de la sesión, cuando el técnico diga con qué orden trabaja, para conocer el contexto antes de entrevistar.',
      parameters: {
        type: 'object',
        properties: {
          orden_id: {
            type: 'string',
            description: 'Identificador de la orden, formato OT-1xxx (p. ej. "OT-1004"). Si el técnico no lo dice completo, usa el que tengas.',
          },
        },
        required: ['orden_id'],
      },
      execution_mode: 'interactive',
    },
    {
      type: 'function',
      name: 'buscar_pieza',
      description:
        'Busca una pieza en el catálogo por nombre hablado, jerga o alias (búsqueda tolerante: minúsculas, sin acentos, sin plurales). ' +
        'Llámala SIEMPRE que el técnico mencione una pieza o repuesto ANTES de agregarla al reporte. ' +
        'La respuesta incluye el mejor candidato (best), hasta 3 alternativas (found) y una advertencia (confusable_warning) ' +
        'si la mejor candidata tiene un par confundible en catálogo (p. ej. válvula 3/4" vs 3/8"): en ese caso debes preguntar la ' +
        'desambiguación en voz alta antes de dar por buena la pieza.',
      parameters: {
        type: 'object',
        properties: {
          consulta: {
            type: 'string',
            description: 'Lo que dijo el técnico, tal cual (p. ej. "la válvula de tres cuartos que gotea"). No limpies ni traduzcas.',
          },
        },
        required: ['consulta'],
      },
      execution_mode: 'interactive',
    },
    {
      type: 'function',
      name: 'agregar_pieza_a_reporte',
      description:
        'Agrega (o acumula) una pieza con su cantidad a la ficha. Solo acepta SKUs del enum (los devueltos por buscar_pieza). ' +
        'La pieza queda SIN confirmar (confirmada=false): la confirmación llega únicamente del read-back hablado — ' +
        'debes leer en voz alta pieza Y cantidad y esperar el "sí" del técnico antes de considerar el dato bueno.',
      parameters: {
        type: 'object',
        properties: {
          sku: skuSchema,
          qty: {
            type: 'integer',
            minimum: 1,
            description: 'Cantidad de piezas que dijo el técnico (por defecto 1). Confírmala también en el read-back.',
          },
        },
        required: ['sku', 'qty'],
      },
      execution_mode: 'interactive',
    },
    {
      type: 'function',
      name: 'set_problema',
      description:
        'Fija el campo "problema" de la ficha con las palabras DEL TÉCNICO (qué falla reporta el equipo ahora). ' +
        'NO parafrasees, NO resumas, NO uses vocabulario técnico que el técnico no haya usado: es evidencia textual.',
      parameters: {
        type: 'object',
        properties: {
          texto: {
            type: 'string',
            description: 'Texto del técnico describiendo el problema (primera persona del técnico, verbatim o casi).',
          },
        },
        required: ['texto'],
      },
      execution_mode: 'interactive',
    },
    {
      type: 'function',
      name: 'set_solucion',
      description:
        'Fija el campo "solución" de la ficha con la narración DEL TÉCNICO (qué hizo para resolverlo y cómo quedó el equipo). ' +
        'No parafrasees ni agregues pasos que no mencionó.',
      parameters: {
        type: 'object',
        properties: {
          texto: {
            type: 'string',
            description: 'Texto del técnico narrando la solución y el resultado final.',
          },
        },
        required: ['texto'],
      },
      execution_mode: 'interactive',
    },
    {
      type: 'function',
      name: 'get_tiempo_trabajo',
      description:
        'Devuelve los minutos transcurridos desde el inicio del trabajo. Llámala cuando cierres la ficha (antes de enviar_reporte) ' +
        'y contrasta en voz alta con lo que diga el técnico ("llevo como cincuenta minutos, ¿es correcto?").',
      parameters: { type: 'object', properties: {} },
      execution_mode: 'interactive',
    },
    {
      type: 'function',
      name: 'enviar_reporte',
      description:
        'CIERRA y envía la ficha de la orden (estado=enviada). Llámala solo cuando el técnico lo pida (\"mándalo\", \"ya está\") ' +
        'Y cuando problema, solución, piezas (todas confirmadas) y tiempo estén capturados; si falta algo, pregúntalo antes de enviar.',
      parameters: { type: 'object', properties: {} },
      execution_mode: 'interactive',
    },
  ];
}

/** Nombres de las 7 tools públicas (para validación en tool-runner/engine). */
export const TOOL_NAMES = [
  'get_orden', 'buscar_pieza', 'agregar_pieza_a_reporte', 'set_problema',
  'set_solucion', 'get_tiempo_trabajo', 'enviar_reporte',
];

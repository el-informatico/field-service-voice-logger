/**
 * agent-config.js — configuración del agente entrevistador (ES, v1).
 * ESM, sin dependencias, DOM-free.
 *
 * Cada parámetro cita la página de docs verificada en
 * docs/research/assemblyai-notes.md (BUILD CONTRACT del 2026-09-15):
 *
 * - system_prompt / greeting / tools / input.* / output.*
 *   → docs/voice-agents/voice-agent-api/session-configuration y
 *     .../api-spec (ejemplo completo de session.update). `greeting` es
 *     INMUTABLE tras session.ready (error `immutable_field`).
 * - turn_detection.vad_threshold (0.0–1.0, default 0.5; más bajo = más
 *   sensible) e interrupt_response (default true = barge-in activado)
 *   → docs/voice-agents/voice-agent-api/turn-detection-and-interruptions.
 * - NO fijamos min_silence/max_silence: son ADAPTATIVOS por defecto y fijarlos
 *   a mano desactiva el pacing adaptativo y la espera de entidades
 *   (advertencia oficial citada en assemblyai-notes.md §Turn detection).
 * - output.format { encoding: "audio/pcm" } + sample_rate 24000
 *   → docs/voice-agents/voice-agent-api/audio-format (PCM16 mono 24 kHz
 *     base64 en JSON, ambos sentidos).
 * - input.transcription_mode "balanced" → mutable mid-session; para pausas
 *   largas de técnico trabajando la docs recomienda "max_accuracy".
 * - input.keyterms → hints de precisión por vocabulario de dominio
 *   (docs/voice-agents/voice-agent-api/session-configuration).
 */

export const AGENT_CONFIG = {
  /** Prompt v1 del entrevistador de órdenes de trabajo (lo lee el LLM real). */
  system_prompt: [
    'Eres el ENTREVISTADOR DE ÓRDENES DE TRABAJO de un sistema de bitácora por voz para técnicos de campo (HVAC y eléctrico) en México.',
    'El técnico tiene las manos ocupadas: habla contigo mientras trabaja. Tu trabajo es llenar la ficha de la orden EN VIVO usando las tools, y confirmar en voz alta los datos críticos.',
    '',
    'REGLAS:',
    '1. Usa las tools para CADA dato: get_orden al arrancar, buscar_pieza antes de cualquier pieza, agregar_pieza_a_reporte para registrarla, set_problema y set_solucion para el texto, get_tiempo_trabajo antes de cerrar, enviar_reporte solo cuando el técnico lo pida y la ficha esté completa.',
    '2. En problema y solución guarda el texto DEL TÉCNICO, sin parafrasear, sin traducir su jerga ("cuateada", "choqueando", "brinca el breaker" se respetan). Es evidencia textual.',
    '3. READ-BACK OBLIGATORIO de piezas y cantidades antes de dar por confirmada una pieza: di el nombre completo con la dimensión deletreada ("válvula de bola de TRES CUARTOS, DOS piezas") y pregunta "¿correcto?". Solo con el "sí" del técnico la pieza queda buena.',
    '4. Si buscar_pieza devuelve confusable_warning, pregunta la DESAMBIGUACIÓN explícita nombrando AMBOS candidatos: "¿decías la válvula de TRES CUARTOS o la de TRES OCTAVOS?". Nunca elijas tú.',
    '5. Una cosa a la vez: una pregunta corta por turno. Frases cortas. Si el técnico te interrumpe, CALLA de inmediato y atiéndelo.',
    '6. No inventes datos, medidas, SKUs ni cantidades. Si no lo dijo el técnico, pregunta.',
    '7. Antes de enviar_reporte verifica que problema, solución, piezas (todas confirmadas por read-back) y tiempo estén capturados; pregunta lo faltante.',
    '8. Español mexicano natural, trato de tú, sin tecnicismos que el técnico no haya usado.',
  ].join('\n'),

  greeting:
    '¡Buen día! Soy tu asistente de bitácora. Dime el número de orden con el que estás trabajando y llenamos la ficha mientras trabajas.',

  /** session.input — VAD/turn-taking (ver citas arriba). */
  turn_detection: {
    vad_threshold: 0.4,        // bajo = más sensible: técnico habla enterrado, con ruido de taller
    interrupt_response: true,  // barge-in activado (default true; explícito por claridad)
    // min_silence/max_silence ADAPTATIVOS a propósito (no fijar; ver notes)
  },

  input: {
    format: { encoding: 'audio/pcm', sample_rate: 24000 },
    transcription_mode: 'balanced',
    keyterms: [
      'OT', 'válvula', 'tres cuartos', 'tres octavos', 'media pulgada',
      'cinco octavos', 'capacitor', 'microfaradios', 'contactor', 'breaker',
      'pastilla', 'amperios', 'manguera', 'neopreno', 'fusible', 'balero',
      'termostato', 'presostato', 'empaque', 'compresor', 'manómetro',
    ],
  },

  /** session.output — voz del agente + formato de audio de salida. */
  output: {
    voice: 'alba',
    format: { encoding: 'audio/pcm', sample_rate: 24000 },
  },
};

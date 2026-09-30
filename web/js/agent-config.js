/**
 * agent-config.js — configuración del agente entrevistador (EN, v1).
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
  /** Prompt v1 del entrevistador de órdenes de trabajo (lo lee el LLM real). Traducción EN: solo cambian los nombres de tools. */
  system_prompt: [
    'You are the WORK-ORDER INTERVIEWER of a voice logbook system for field technicians (HVAC and electrical) in Mexico.',
    'The technician has their hands busy: they talk to you while they work. Your job is to fill the work-order card LIVE using the tools, and to confirm the critical data out loud.',
    '',
    'RULES:',
    '1. Use the tools for EVERY datum: get_order at the start, search_part before any part, add_part_to_report to log it, set_problem and set_solution for the text, get_work_time before closing, send_report only when the technician asks for it and the card is complete.',
    '2. In problem and solution store THE TECHNICIAN\'s text, without paraphrasing, without translating their jargon ("seized", "chattering", "the breaker trips" are kept as said). It is textual evidence.',
    '3. MANDATORY READ-BACK of parts and quantities before considering a part confirmed: say the full name with the dimension spelled out ("brass ball valve THREE QUARTERS, TWO pieces") and ask "correct?". Only with the technician\'s "yes" is the part good.',
    '4. If search_part returns confusable_warning, ask the explicit DISAMBIGUATION naming BOTH candidates: "did you mean the THREE QUARTERS valve, or the THREE EIGHTHS one?". Never choose yourself.',
    '5. One thing at a time: one short question per turn. Short sentences. If the technician interrupts you, STOP immediately and attend to them.',
    '6. Do not invent data, measurements, SKUs or quantities. If the technician did not say it, ask.',
    '7. Before send_report verify that problem, solution, parts (all confirmed by read-back) and time are captured; ask for whatever is missing.',
    '8. Natural, friendly spoken English; keep it plain, no technical terms the technician has not used.',
  ].join('\n'),

  greeting:
    "Good day! I'm your work-log assistant. Tell me the order number you're working on and we'll fill the card while you work.",

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
      // vocabulario ES del catálogo (congelado) + equivalentes EN que ahora
      // dice el técnico: keyterms son hints de transcripción (input), no TTS.
      'OT', 'válvula', 'tres cuartos', 'tres octavos', 'media pulgada',
      'cinco octavos', 'capacitor', 'microfaradios', 'contactor', 'breaker',
      'pastilla', 'amperios', 'manguera', 'neopreno', 'fusible', 'balero',
      'termostato', 'presostato', 'empaque', 'compresor', 'manómetro',
      'valve', 'three quarters', 'three eighths', 'half inch', 'five eighths',
      'microfarad', 'hose', 'gasket', 'contactor', 'amperes', 'coil',
      'pressure switch', 'bearing', 'thermostat', 'compressor',
    ],
  },

  /** session.output — voz del agente + formato de audio de salida. */
  output: {
    voice: 'alba',
    format: { encoding: 'audio/pcm', sample_rate: 24000 },
  },
};

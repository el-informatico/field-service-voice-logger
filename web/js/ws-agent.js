/**
 * ws-agent.js — canal REAL: WebSocket crudo al Voice Agent API de AssemblyAI
 * (browser). ESM, sin dependencias. Se ejercita de verdad el D1 con API key;
 * hoy debe ser sintácticamente válido, bien estructurado y sus mapeadores
 * puros unit-testeables.
 *
 * Protocolo VERIFICADO (docs/research/assemblyai-notes.md, 2026-09-15):
 *  - URL: wss://agents.assemblyai.com/v1/ws?token=<temp_token>  (sin headers)
 *  - Al abrir: session.update (system_prompt + greeting + tools + turn_detection
 *    + output pcm16 24k). Esperar session.ready ANTES de mandar audio.
 *  - Mic → input.audio {audio: base64 PCM16 mono 24k} a ritmo real (~50ms ok;
 *    >1s/s → audio_rate_violation).
 *  - Agent → reply.audio {data: base64} → encolar playback; input.speech.started
 *    = barge-in → flush inmediato del playback.
 *  - tool.call {call_id, name, arguments(dict)} → ejecutar → tool.result con
 *    `result` como STRING JSON, enviado cuando el último evento recibido es
 *    reply.done (patrón pending/drain).
 *  - Cierre SIEMPRE con session.end (la facturación corre por WS abierto +
 *    30s de grace window billable).
 *
 * Interfaz de Canal (idéntica a mock-agent.js):
 *   on(type, fn) / send(type, data) / start() / stop() / clock
 * Vocabulario de eventos: ver web/README.md.
 */
import { realClock } from './clock.js';
import { AGENT_CONFIG } from './agent-config.js';
import { detectConfirmation } from './dialog-act.js';

export const WS_URL = 'wss://agents.assemblyai.com/v1/ws';

/* ================================================================== */
/* Mapeadores PUROS (unit-testeables en Node, sin WebSocket)           */
/* ================================================================== */

/**
 * session.update completo a partir de la config del agente + tools.
 * Shape según docs (session-configuration). Nota: NO se fijan
 * min_silence/max_silence (adaptativos; fijarlos mata el pacing adaptativo).
 *
 * @param {object} config  AGENT_CONFIG (js/agent-config.js)
 * @param {Array} tools    definiciones de js/tools.js (buildToolDefinitions)
 * @returns {object} mensaje listo para ws.send(JSON.stringify(...))
 */
export function buildSessionUpdate(config = AGENT_CONFIG, tools = []) {
  return {
    type: 'session.update',
    session: {
      system_prompt: config.system_prompt,
      greeting: config.greeting,
      tools,
      input: {
        format: config.input?.format ?? { encoding: 'audio/pcm', sample_rate: 24000 },
        transcription_mode: config.input?.transcription_mode ?? 'balanced',
        ...(config.input?.keyterms?.length ? { keyterms: config.input.keyterms } : {}),
        turn_detection: { ...config.turn_detection },
      },
      output: {
        voice: config.output?.voice ?? 'alba',
        format: config.output?.format ?? { encoding: 'audio/pcm', sample_rate: 24000 },
      },
    },
  };
}

/**
 * Mensaje servidor → eventos del vocabulario del canal (misma lista que el
 * mock; los internos de audio no se emiten al engine). Tolerante: mensajes
 * desconocidos → [].
 *
 * @returns {Array<{type:string, ...}>} eventos a emitir
 */
export function mapServerMessage(msg) {
  if (!msg || typeof msg !== 'object') return [];
  switch (msg.type) {
    case 'session.ready':
      return [{ type: 'ready', session_id: msg.session_id, expires_at: msg.expires_at }];
    case 'session.updated':
      return []; // eco del config; nada que hacer
    case 'session.ended':
      return [{ type: 'ended', duration_s: msg.session_duration_seconds }];
    case 'session.error':
      return [{ type: 'error', code: msg.code ?? 'unknown', message: msg.message ?? '' }];
    case 'input.speech.started':
      return [{ type: 'user_turn_start', raw: 'input.speech.started' }];
    case 'input.speech.stopped':
      return [{ type: 'user_speech_stopped', raw: 'input.speech.stopped' }];
    case 'transcript.user.delta':
      return [{ type: 'user_turn_delta', text: msg.text ?? '' }];
    case 'transcript.user':
      return [{ type: 'user_turn_end', text: msg.text ?? '' }];
    case 'reply.started':
      return [{ type: 'agent_turn_start', reply_id: msg.reply_id }];
    case 'transcript.agent.delta':
      return [{ type: 'agent_turn_text', text: msg.delta ?? '', reply_id: msg.reply_id }];
    case 'transcript.agent':
      return [{
        type: 'agent_turn_end',
        text: msg.text ?? '',
        interrupted: msg.interrupted === true,
        reply_id: msg.reply_id,
      }];
    case 'reply.audio':
      return [{ type: '__audio', data: msg.data ?? '' }]; // interno (playback)
    case 'reply.done':
      return [{ type: '__reply_done', reply_id: msg.reply_id, status: msg.status }]; // interno (drain de tool.result)
    case 'tool.call':
      return [{ type: 'tool_call', call_id: msg.call_id, tool: msg.name, args: msg.arguments ?? {} }];
    default:
      return [];
  }
}

/** tool.result listo para enviar (result = STRING JSON, per docs). */
export function buildToolResult(callId, result, isError = false) {
  return {
    type: 'tool.result',
    call_id: callId,
    result: typeof result === 'string' ? result : JSON.stringify(result ?? {}),
    is_error: !!isError,
  };
}

/* ================================================================== */
/* Audio helpers puros (exportados para test)                          */
/* ================================================================== */

export function float32ToPcm16(f32) {
  const out = new Int16Array(f32.length);
  for (let i = 0; i < f32.length; i++) {
    const s = Math.max(-1, Math.min(1, f32[i]));
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return out;
}

export function pcm16ToFloat32(i16) {
  const out = new Float32Array(i16.length);
  for (let i = 0; i < i16.length; i++) out[i] = i16[i] / 32768;
  return out;
}

/** Downsample por factor racional con promediado (48k→24k = /2). */
export function downsample(f32, fromRate, toRate) {
  if (fromRate === toRate) return f32;
  const ratio = fromRate / toRate;
  const n = Math.floor(f32.length / ratio);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const start = Math.floor(i * ratio);
    const end = Math.min(f32.length, Math.floor((i + 1) * ratio));
    let sum = 0;
    for (let j = start; j < end; j++) sum += f32[j];
    out[i] = end > start ? sum / (end - start) : 0;
  }
  return out;
}

export function bytesToBase64(bytes) {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export function base64ToPcm16(b64) {
  const binary = atob(b64);
  const out = new Int16Array(binary.length >> 1);
  for (let i = 0; i < out.length; i++) {
    out[i] = binary.charCodeAt(2 * i) | (binary.charCodeAt(2 * i + 1) << 8);
  }
  return out;
}

/* ================================================================== */
/* AudioWorklet inline (Blob URL — sin archivo extra ni build step)     */
/* ================================================================== */

const MIC_WORKLET_SRC = /* js */ `
class MicCaptureProcessor extends AudioWorkletProcessor {
  process(inputs) {
    const input = inputs[0];
    if (!input || !input[0]) return true;
    // promedia canales → mono
    const ch0 = input[0];
    let mono = ch0;
    if (input.length > 1) {
      mono = new Float32Array(ch0.length);
      for (let c = 0; c < input.length; c++) {
        const ch = input[c];
        for (let i = 0; i < ch.length; i++) mono[i] += ch[i] / input.length;
      }
    }
    // downsample ctx.sampleRate → 24000 con promediado
    const ratio = sampleRate / 24000;
    const n = Math.floor(mono.length / ratio);
    const out24 = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const s = Math.floor(i * ratio), e = Math.min(mono.length, Math.floor((i + 1) * ratio));
      let sum = 0;
      for (let j = s; j < e; j++) sum += mono[j];
      out24[i] = e > s ? sum / (e - s) : 0;
    }
    // float32 → pcm16 little-endian
    const pcm = new Int16Array(out24.length);
    for (let i = 0; i < out24.length; i++) {
      const v = Math.max(-1, Math.min(1, out24[i]));
      pcm[i] = v < 0 ? v * 0x8000 : v * 0x7fff;
    }
    this.port.postMessage(pcm.buffer, [pcm.buffer]);
    return true;
  }
}
registerProcessor('mic-capture', MicCaptureProcessor);
`;

/* ================================================================== */
/* Canal real                                                          */
/* ================================================================== */

/**
 * @param {object} opts
 * @param {string} opts.token        token temporal de un solo uso (POST /api/token)
 * @param {Array}  [opts.tools]      definiciones (js/tools.js); default []
 * @param {object} [opts.config]     AGENT_CONFIG override
 * @param {(t:string)=>boolean} [opts.getLogger] noop
 */
export function createRealAgentChannel({ token, tools = [], config = AGENT_CONFIG } = {}) {
  if (!token || token === 'mock') {
    throw new Error('createRealAgentChannel: falta token real (modo mock usa mock-agent.js)');
  }
  const clock = realClock();
  const handlers = new Map();
  const on = (type, fn) => {
    if (!handlers.has(type)) handlers.set(type, new Set());
    handlers.get(type).add(fn);
    return () => handlers.get(type)?.delete(fn);
  };
  const emit = (type, data = {}) => { for (const fn of [...(handlers.get(type) ?? [])]) fn(data); };

  let ws = null;
  let ready = false;
  let closed = false;
  let lastReplyDoneSeen = true; // el primer tool.call tras reply.done drena directo
  const pendingToolResults = []; // tool.result en espera de un reply.done (patrón docs)

  /* audio */
  let micCtx = null;
  let micStream = null;
  let micNode = null;
  let playCtx = null;
  let playQueue = [];
  let playHead = { source: null, playing: false, interrupted: false };
  let agentSpeechStartedAt = null;
  let lastAgentDeltaText = '';
  let lastAggregated = '';

  function sendRaw(obj) {
    if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj));
  }

  async function start() {
    if (typeof WebSocket === 'undefined') {
      throw new Error('WebSocket no disponible (este canal es browser-only)');
    }
    const url = `${WS_URL}?token=${encodeURIComponent(token)}`;
    ws = new WebSocket(url);
    ws.onopen = () => sendRaw(buildSessionUpdate(config, tools));
    ws.onmessage = (ev) => onRawMessage(ev.data);
    ws.onerror = () => emit('error', { code: 'ws_error', message: 'error de WebSocket' });
    ws.onclose = (ev) => {
      if (!closed) emit('error', { code: `ws_close_${ev.code}`, message: ev.reason || 'WS cerrado' });
      emit('ended', {});
    };
  }

  function onRawMessage(raw) {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    for (const evt of mapServerMessage(msg)) {
      if (evt.type === '__audio') { enqueueAudio(evt.data); continue; }
      if (evt.type === '__reply_done') {
        lastReplyDoneSeen = true;
        if (evt.status === 'interrupted') flushPlayback();
        drainPendingToolResults();
        continue;
      }
      handleMappedEvent(evt);
    }
  }

  function handleMappedEvent(evt) {
    switch (evt.type) {
      case 'ready':
        ready = true;
        startMic().catch((err) => emit('error', { code: 'mic_error', message: String(err?.message ?? err) }));
        emit('ready', { session_id: evt.session_id });
        break;
      case 'user_turn_start': // input.speech.started = barge-in temprano
        if (playHead.playing || playQueue.length) {
          const cut = lastAggregated || lastAgentDeltaText;
          flushPlayback();
          emit('barge_in', {
            agent_text_cut: cutText(cut),
            user_text: '',
            latency_ms: Math.round(clock.now() - (agentSpeechStartedAt ?? clock.now())),
          });
        }
        emit('user_turn_start', evt);
        break;
      case 'user_turn_end':
        // confirm_result derivado del clasificador compartido (loop de read-back)
        deriveConfirmResult(evt.text);
        emit('user_turn_end', evt);
        break;
      case 'agent_turn_start':
        agentSpeechStartedAt = clock.now();
        lastAggregated = '';
        emit('agent_turn_start', evt);
        break;
      case 'agent_turn_text':
        lastAgentDeltaText = evt.text;
        lastAggregated += evt.text;
        emit('agent_turn_text', evt);
        break;
      case 'agent_turn_end':
        lastAggregated = evt.text || lastAggregated;
        maybeConfirmRequest(lastAggregated);
        emit('agent_turn_end', evt);
        break;
      case 'tool_call':
        // lo ejecuta el engine (on tool_call) y nos devuelve tool_result por send()
        lastReplyDoneSeen = false;
        emit('tool_call', evt);
        break;
      default:
        emit(evt.type, evt);
    }
  }

  /* ---------------- tool.result (patrón pending/drain de las docs) --- */

  function send(type, data = {}) {
    if (type === 'tool_result') {
      trackToolResult(data);
      pendingToolResults.push(buildToolResult(data.call_id, data.result, data.ok === false));
      if (lastReplyDoneSeen) drainPendingToolResults();
    } else if (type === 'stop') {
      stop();
    }
  }

  function drainPendingToolResults() {
    while (pendingToolResults.length) sendRaw(pendingToolResults.shift());
  }

  /* ------------- confirmación hablada (mismo clasificador que mock) --- */
  // El LLM real decide el read-back hablado; el canal deriva los eventos del
  // artefacto: agregar_pieza (tool_result) + texto del agente con pregunta
  // → confirm_request; el "sí/no" del técnico → confirm_result.

  let lastAddedPieza = null;      // {sku, nombre, qty} del último agregar ok
  let pendingConfirmValue = null; // read-back en espera de respuesta

  function trackToolResult(data) {
    if (data?.tool === 'agregar_pieza_a_reporte' && data.ok && data.result?.sku) {
      lastAddedPieza = {
        sku: data.result.sku, nombre: data.result.nombre, qty: data.result.qty,
      };
    }
  }

  function maybeConfirmRequest(agentText) {
    if (!lastAddedPieza || !agentText) return;
    const isReadBack = /dec[íi]as|correcto\?|confirmo|se cambian|una pieza|pieza/i.test(agentText)
      && /[?¿]/.test(agentText);
    if (!isReadBack) return;
    pendingConfirmValue = { ...lastAddedPieza };
    lastAddedPieza = null;
    emit('confirm_request', { field: 'pieza', value: pendingConfirmValue });
  }

  function deriveConfirmResult(userText) {
    if (!pendingConfirmValue || !userText) return;
    const conf = detectConfirmation(userText);
    if (conf === 'yes' || conf === 'no') {
      emit('confirm_result', { field: 'pieza', value: pendingConfirmValue, confirmed: conf === 'yes' });
      pendingConfirmValue = null;
    }
  }

  /* ------------------------------ mic ------------------------------- */

  async function startMic() {
    micStream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: false, autoGainControl: false, channelCount: 1 },
    });
    micCtx = new AudioContext(); // el worklet baja a 24k sin importar el rate del ctx
    const src = micCtx.createMediaStreamSource(micStream);
    const blobUrl = URL.createObjectURL(new Blob([MIC_WORKLET_SRC], { type: 'application/javascript' }));
    await micCtx.audioWorklet.addModule(blobUrl);
    micNode = new AudioWorkletNode(micCtx, 'mic-capture');
    micNode.port.onmessage = ({ data }) => {
      if (!ready || !ws || ws.readyState !== 1) return;
      const bytes = new Uint8Array(data);
      sendRaw({ type: 'input.audio', audio: bytesToBase64(bytes) });
    };
    src.connect(micNode); // worklet sin salida → no conectar a destination
  }

  /* ---------------------------- playback ----------------------------- */

  function ensurePlayCtx() {
    if (!playCtx) playCtx = new AudioContext({ sampleRate: 24000 });
    return playCtx;
  }

  function enqueueAudio(b64) {
    const ctx = ensurePlayCtx();
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    const pcm = base64ToPcm16(b64);
    let f32 = pcm16ToFloat32(pcm);
    if (ctx.sampleRate !== 24000) f32 = resampleLinear(f32, 24000, ctx.sampleRate);
    const buf = ctx.createBuffer(1, f32.length, ctx.sampleRate);
    buf.copyToChannel(f32, 0);
    playQueue.push(buf);
    pumpPlayback();
  }

  function pumpPlayback() {
    if (playHead.playing || !playQueue.length) return;
    const ctx = ensurePlayCtx();
    const src = ctx.createBufferSource();
    src.buffer = playQueue.shift();
    src.connect(ctx.destination);
    playHead = { source: src, playing: true, interrupted: false };
    src.onended = () => {
      playHead.playing = false;
      if (!playHead.interrupted) pumpPlayback();
    };
    src.start();
  }

  function flushPlayback() {
    playQueue = [];
    if (playHead.source) {
      playHead.interrupted = true;
      try { playHead.source.stop(); } catch { /* ya parado */ }
    }
    playHead = { source: null, playing: false, interrupted: false };
  }

  function resampleLinear(f32, from, to) {
    const ratio = from / to;
    const n = Math.floor(f32.length / ratio);
    const out = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const x = i * ratio;
      const i0 = Math.floor(x);
      const i1 = Math.min(f32.length - 1, i0 + 1);
      const fr = x - i0;
      out[i] = f32[i0] * (1 - fr) + f32[i1] * fr;
    }
    return out;
  }

  function cutText(t) {
    const s = String(t ?? '').trim();
    return s ? `${s.slice(0, Math.max(1, Math.round(s.length * 0.7)))}—` : '';
  }

  /* ------------------------------ stop ------------------------------- */

  async function stop() {
    if (closed) return;
    closed = true;
    flushPlayback();
    if (ws && ws.readyState === 1) {
      sendRaw({ type: 'session.end' }); // SIEMPRE: evita 30s billables del grace window
      const sock = ws;
      setTimeout(() => { if (sock.readyState === 1) sock.close(); }, 3000);
    } else ws?.close?.();
    try { micNode?.port && (micNode.port.onmessage = null); } catch { /* noop */ }
    micStream?.getTracks?.().forEach((t) => t.stop());
    micCtx?.close().catch(() => {});
    playCtx?.close().catch(() => {});
  }

  return { on, send, start, stop, clock, get isMock() { return false; } };
}

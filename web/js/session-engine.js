/**
 * session-engine.js — EL NÚCLEO (DOM-free, corre en browser y Node 22).
 * ESM, sin dependencias.
 *
 * Construye incrementalmente el ARTEFACTO DE SESIÓN (architecture.md §6) a
 * partir de los eventos del canal (mock determinista o AssemblyAI real vía
 * ws-agent.js). Es agnóstico al driver: solo conoce el vocabulario de eventos
 * del Canal (ver web/README.md):
 *
 *   El canal emite:  ready | user_turn_start | user_turn_end | agent_turn_start
 *                   | agent_turn_text | agent_turn_end | tool_call
 *                   | confirm_request | confirm_result | barge_in
 *                   | report_sent | error | ended
 *   El engine responde por channel.send('tool_result', {call_id, ok, result}).
 *
 * El engine es el EJECUTOR de las tools: tool_call → toolRunner.call →
 * tool_result (al canal + al artefacto) → form_update si la ficha cambió.
 * Las mutaciones de confirmación pasan por store.markConfirmada.
 *
 * t_ms sale del reloj inyectable (realClock en modo real; el simClock del mock
 * en replay — determinista corrida a corrida).
 */
import { realClock } from './clock.js';
import { AGENT_CONFIG } from './agent-config.js';

export function createSessionEngine({ channel, toolRunner, store, meta, clock, onEvent } = {}) {
  if (!channel) throw new Error('createSessionEngine: falta channel');
  if (!toolRunner) throw new Error('createSessionEngine: falta toolRunner');
  if (!store) throw new Error('createSessionEngine: falta store');
  const {
    session_id = 'sess_local',
    scenario_id = null,
    mode = 'mock',
    order_id = null,
    noise_condition = 'clean',
  } = meta ?? {};

  const clk = clock ?? realClock();
  const startedAtWall = new Date().toISOString();
  const events = [];
  const transcript = [];
  let endedAtWall = null;
  let ended = false;
  let callSeq = 0;

  /* turnos abiertos */
  let openUser = null;    // {role:'user', text:'', t_start_ms}
  let openAgent = null;   // {role:'agent', text:'', t_start_ms}
  let unsubs = [];

  /* ---------------------------------------------------------------- */
  /* Registro                                                          */
  /* ---------------------------------------------------------------- */

  function ev(type, extra = {}) {
    const e = { t_ms: Math.round(clk.now()), type, ...extra };
    events.push(e);
    return e;
  }

  function snapshotForm() {
    return JSON.parse(JSON.stringify(store.final_form));
  }

  /** Registra form_update con la lista exacta de campos que cambiaron. */
  function recordFormUpdate(prevSnapshot, why) {
    const after = snapshotForm();
    const changed = Object.keys(after).filter(
      (k) => JSON.stringify(after[k]) !== JSON.stringify(prevSnapshot[k]),
    );
    if (changed.length) {
      ev('form_update', { changed, form: after, why });
      return true;
    }
    return false;
  }

  /* ---------------------------------------------------------------- */
  /* Manejo de eventos del canal                                       */
  /* ---------------------------------------------------------------- */

  function closeUserTurn(text) {
    if (!openUser) return;
    openUser.text = text ?? openUser.text;
    openUser.t_end_ms = Math.round(clk.now());
    transcript.push(openUser);
    ev('user_turn_end', { text: openUser.text });
    openUser = null;
  }

  function closeAgentTurn({ interrupted = false } = {}) {
    if (!openAgent) return null;
    const text = openAgent.text;
    openAgent.t_end_ms = Math.round(clk.now());
    transcript.push(openAgent);
    ev('agent_turn_end', { text, ...(interrupted ? { interrupted: true } : {}) });
    openAgent = null;
    return text;
  }

  async function onToolCall({ call_id, tool, args }) {
    const id = call_id ?? `c${++callSeq}`;
    ev('tool_call', { call_id: id, tool, args: safeJson(args) });
    const prevSnap = snapshotForm();
    const { ok, result } = await toolRunner.call(tool, args ?? {});
    ev('tool_result', { call_id: id, tool, ok, result: safeJson(result) });
    recordFormUpdate(prevSnap, `tool:${tool}`);
    channel.send?.('tool_result', { call_id: id, tool, ok, result });
    return result;
  }

  function onConfirmResult({ field, value, confirmed }) {
    const prevSnap = snapshotForm();
    ev('confirm_result', { field, value: safeJson(value), confirmed: !!confirmed });
    if (field === 'pieza' && value?.sku) store.markConfirmada(value.sku, !!confirmed);
    recordFormUpdate(prevSnap, `confirm:${confirmed ? 'ok' : 'rechazo'}`);
  }

  /** Punto único de entrada (el canal y las pruebas llaman aquí). */
  async function handleEvent(type, data = {}) {
    try {
      await dispatch(type, data);
    } finally {
      onEvent?.(type, data); // hook para UI/tests (post-procesamiento)
    }
  }

  async function dispatch(type, data = {}) {
    switch (type) {
      case 'ready':
        break; // session_start ya quedó registrado en start()
      case 'user_turn_start':
        if (openAgent) closeAgentTurn({ interrupted: true }); // barge-in real
        ev('user_turn_start');
        openUser = { role: 'user', text: '', t_start_ms: Math.round(clk.now()) };
        break;
      case 'user_turn_delta':
        if (openUser) openUser.text = data.text ?? openUser.text; // parcial, no se registra
        break;
      case 'user_turn_end':
        closeUserTurn(data.text);
        break;
      case 'agent_turn_start':
        if (openUser) closeUserTurn(openUser.text);
        ev('agent_turn_start');
        openAgent = { role: 'agent', text: '', t_start_ms: Math.round(clk.now()) };
        break;
      case 'agent_turn_text':
        if (openAgent) openAgent.text += (data.text ?? '');
        break;
      case 'agent_turn_end':
        closeAgentTurn({ interrupted: !!data.interrupted });
        break;
      case 'tool_call':
        await onToolCall(data);
        break;
      case 'tool_result': // solo si un driver externo ya ejecutó la tool
        ev('tool_result', { call_id: data.call_id, tool: data.tool, ok: data.ok, result: safeJson(data.result) });
        break;
      case 'confirm_request':
        ev('confirm_request', { field: data.field, value: safeJson(data.value) });
        break;
      case 'confirm_result':
        onConfirmResult(data);
        break;
      case 'barge_in': {
        const cutText = closeAgentTurn({ interrupted: true });
        ev('barge_in', {
          agent_text_cut: data.agent_text_cut ?? cut(cutText),
          user_text: data.user_text ?? '',
          latency_ms: data.latency_ms ?? null,
        });
        break;
      }
      case 'report_sent':
        ev('report_sent');
        break;
      case 'error':
        ev('session_error', { code: data.code ?? 'unknown', message: data.message ?? '' });
        break;
      case 'ended':
        closeUserTurn(openUser?.text);
        closeAgentTurn({});
        ended = true;
        break;
      default:
        break; // vocabulario desconocido: tolerante (p. ej. user_turn_delta del canal real)
    }
  }

  function cut(text, frac = 0.6) {
    const t = String(text ?? '');
    if (!t) return '';
    const n = Math.max(1, Math.round(t.length * frac));
    return t.slice(0, n).replace(/[\s,;:]+$/, '') + '—';
  }

  /* ---------------------------------------------------------------- */
  /* Ciclo de vida                                                     */
  /* ---------------------------------------------------------------- */

  function wire() {
    const types = [
      'ready', 'user_turn_start', 'user_turn_delta', 'user_turn_end',
      'agent_turn_start', 'agent_turn_text', 'agent_turn_end', 'tool_call',
      'confirm_request', 'confirm_result', 'barge_in', 'report_sent',
      'error', 'ended',
    ];
    unsubs = types.map((t) => channel.on?.(t, (d) => { handleEvent(t, d); }));
  }

  function start() {
    ev('session_start');
    store.startWork(clk.now());
    wire();
    return this;
  }

  /** Cierra la sesión y devuelve el artefacto completo (§6). */
  function end() {
    if (!ended) {
      closeUserTurn(openUser?.text);
      closeAgentTurn({});
      ended = true;
    }
    endedAtWall = new Date().toISOString();
    return {
      schema_version: 1,
      session_id,
      scenario_id,
      mode,
      order_id: order_id ?? store.final_form.order_id ?? null,
      started_at: startedAtWall,
      ended_at: endedAtWall,
      audio_retained: false,
      turn_detection: { ...AGENT_CONFIG.turn_detection },
      noise_condition,
      events,
      transcript,
      final_form: store.exportFinal(),
    };
  }

  return {
    meta: { session_id, scenario_id, mode, order_id, noise_condition },
    start, end, handleEvent,
    get events() { return events; },
    get transcript() { return transcript; },
    get store() { return store; },
  };
}

/** JSON-serializable seguro (args/results deben poder ir como string JSON). */
function safeJson(x) {
  if (x == null) return x;
  try {
    return JSON.parse(JSON.stringify(x));
  } catch {
    return { error: 'no_serializable' };
  }
}

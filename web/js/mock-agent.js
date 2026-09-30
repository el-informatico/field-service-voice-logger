/**
 * mock-agent.js — canal MOCK: entrevistador determinista por reglas (sin LLM).
 * ESM, sin dependencias, DOM-free (browser + Node 22).
 *
 * Implementa la MISMA interfaz de Canal que ws-agent.js (modo real):
 *   on(type, fn) → unsubscribe     eventos hacia engine/UI (vocabulario en web/README.md)
 *   send(type, data)               engine→canal: tool_result | advance | user_text
 *                                  | interrupt_request | stop
 *   start(): Promise<void>         resuelve al terminar la sesión (ended)
 *   stop()
 *   clock                          simClock determinista (fuente de t_ms)
 *
 * Reglas del juego:
 *  - NO toca el store: TODO pasa por tool_call/tool_result (el engine ejecuta
 *    contra tool-runner, igual que con el agente real de AssemblyAI).
 *  - Replay de guion (data/guiones/*.json): cada turno user puede llevar
 *    `as_heard` (transcripción simulada, p. ej. el error sembrado de s2) e
 *    `interrupt:true` (barge-in a mitad del discurso del agente en curso).
 *    web/js/guion-sim.js los deriva del ground-truth.
 *  - Pacing determinista: PRNG mulberry32 con seed fija por escenario → los
 *    t_ms del artefacto son idénticos entre corridas. `speed` = 1 tiempo real
 *    (demo en browser), speed = Infinity instantáneo (CI/headless).
 */
import { simClock } from './clock.js';
import { AGENT_CONFIG } from './agent-config.js';
import {
  detectConfirmation, detectPartMention, detectSend, extractNotas, parseMinutes,
  parseQty, distinguisherTokens, mentionsAny, speakNombre, normalizeText,
  stripAccents,
} from './dialog-act.js';
import { esBridge } from './tool-runner.js';

export function createMockAgentChannel({
  ordenes = [], piezas = [], guion = { turns: [] }, speed = 1, seed,
} = {}) {
  /* ------------------------------------------------------------ */
  /* Infra: emitter + scheduler determinista                       */
  /* ------------------------------------------------------------ */

  const handlers = new Map();
  function on(type, fn) {
    if (!handlers.has(type)) handlers.set(type, new Set());
    handlers.get(type).add(fn);
    return () => handlers.get(type)?.delete(fn);
  }
  function emit(type, data = {}) {
    for (const fn of [...(handlers.get(type) ?? [])]) fn(data);
  }

  const clock = simClock(0);
  const rng = mulberry32(seed ?? hashStr(String(guion.scenario_id ?? 'mock')));

  let tasks = [];         // {at, seq, fn, cancelled, done, resolve}
  let seq = 0;
  let pumping = false;
  let stopped = false;
  const instant = !(Number.isFinite(speed) && speed > 0 && speed < 1e6);
  const sleep = (ms) => new Promise((r) => setTimeout(r, Math.max(0, ms)));

  function schedule(delayMs, fn) {
    const t = {
      at: clock.now() + Math.max(0, delayMs), seq: seq++, fn, cancelled: false,
      done: null, resolve: null,
    };
    t.done = new Promise((res) => { t.resolve = res; });
    tasks.push(t);
    pump();
    return { cancel: () => { t.cancelled = true; }, done: t.done };
  }

  /**
   * Loop de tareas: cada task arranca en orden (at, seq) y su fn corre hasta su
   * primer await. Una fn que agenda sub-tareas y les espera NO bloquea la cola
   * (el barge-in y los chunks dependen de ello). Orden determinista porque cada
   * fn corre síncrona hasta su primer await y las tareas se ordenan por (at, seq).
   */
  async function pump() {
    if (pumping) return;
    pumping = true;
    try {
      while (tasks.length && !stopped) {
        tasks.sort((a, b) => (a.at - b.at) || (a.seq - b.seq));
        // Espera en tiempo de PARED con presupuesto único por tarea (el simClock
        // solo avanza al EJECUTAR la tarea, no puede medir la espera).
        let t = tasks[0];
        let budget = instant ? 0 : Math.max(0, (t.at - clock.now()) / speed);
        while (budget > 0 && !stopped) {
          const slice = Math.min(20, budget);
          await sleep(slice);
          budget -= slice;
          tasks.sort((a, b) => (a.at - b.at) || (a.seq - b.seq));
          if (tasks[0] !== t) { t = null; break; } // llegó una más temprana
        }
        if (!t) continue;
        const run = tasks.shift();
        if (run !== t) { tasks.unshift(run); continue; } // carrera: re-evaluar
        if (t.cancelled) { t.resolve(undefined); continue; }
        clock.set(t.at);
        // NO se espera la fn: permite interleave con sub-tareas agendadas.
        // El valor de retorno de fn() viaja en done (para consumedNext, etc.).
        Promise.resolve()
          .then(() => t.fn())
          .then(
            (r) => t.resolve(r),
            (err) => { console.error('[mock-agent] task error:', err); t.resolve(undefined); },
          );
        await Promise.resolve(); // cede el paso a la siguiente tarea del loop
      }
    } finally { pumping = false; }
    if (tasks.length && !stopped) pump(); // re-arranca si agendaron durante la salida
  }

  function pause(ms) { return schedule(ms, async () => {}).done; }

  /* ------------------------------------------------------------ */
  /* Tool calls vía el protocolo del canal (nunca directo al store) */
  /* ------------------------------------------------------------ */

  let callSeq = 0;
  const pendingCalls = new Map(); // call_id → resolve
  async function callTool(tool, args) {
    const call_id = `m${++callSeq}`;
    const p = new Promise((resolve) => pendingCalls.set(call_id, resolve));
    emit('tool_call', { call_id, tool, args });
    const out = await p;
    return out?.result ?? {};
  }

  /* ------------------------------------------------------------ */
  /* Estado del entrevistador                                      */
  /* ------------------------------------------------------------ */

  const bySku = new Map(piezas.map((p) => [p.sku, p]));
  const st = {
    ordenCargada: false, problemaSet: false, diagnosticoSet: false,
    solucionSet: false, tiempoSet: false, enviado: false,
  };
  let orden = null;
  let pendingConfirm = null;   // {kind:'disambiguation'|'plain', captured:{pieza,qty}, sibling}
  let speechCtx = null;        // {cancelled} del _speakChunks en curso (botón ¡Espera!)
  let overrideNext = null;     // texto libre del input de la UI
  let autoReplay = true;
  let gate = null;             // modo manual: espera 'advance'
  const userTurns = (guion.turns ?? []).filter((t) => t.role === 'user');
  const addedSkus = new Map(); // sku → pieza (lo que este canal agregó)
  const confirmedSkus = new Set();

  let doneResolve;
  const done = new Promise((res) => { doneResolve = res; });

  /* ------------------------------------------------------------ */
  /* API del canal                                                 */
  /* ------------------------------------------------------------ */

  const api = {
    on, clock, get isMock() { return true; },
    get autoReplay() { return autoReplay; },
    set autoReplay(v) {
      autoReplay = !!v;
      // si había un turno esperando el botón "siguiente", reactivar el flujo
      if (autoReplay && gate) { gate(); gate = null; }
    },
    get pendingConfirm() { return pendingConfirm; },
    send, start, stop: doStop,
  };

  function send(type, data = {}) {
    switch (type) {
      case 'tool_result': {
        const res = pendingCalls.get(data.call_id);
        if (res) { pendingCalls.delete(data.call_id); res(data); }
        break;
      }
      case 'advance':
        if (gate) { gate(); gate = null; }
        break;
      case 'user_text':
        if (data?.text) overrideNext = String(data.text);
        break;
      case 'interrupt_request':
        manualInterrupt(data?.text);
        break;
      case 'stop':
        doStop();
        break;
      default: break;
    }
  }

  function doStop() {
    if (stopped) return;
    stopped = true;
    tasks.forEach((t) => { t.cancelled = true; t.resolve(); });
    tasks = [];
    emit('ended', {});
    doneResolve();
  }

  async function start() {
    await schedule(500 + rng() * 400, async () => {
      emit('agent_turn_start', {});
      await speakChunks(AGENT_CONFIG.greeting);
    }).done;
    await scheduleNext(0);
    return done;
  }

  async function scheduleNext(i) {
    if (stopped) return;
    if (i >= userTurns.length) {
      schedule(300, async () => doStop());
      return;
    }
    let turn = userTurns[i];
    if (overrideNext) {
      turn = { ...turn, text: overrideNext, as_heard: null, interrupt: false };
      overrideNext = null;
    }
    await schedule(i === 0 ? 1200 + rng() * 1500 : 1200 + rng() * 1800, async () => {
      if (!autoReplay) await new Promise((res) => { gate = res; });
      const consumedNext = await playUserTurn(turn, userTurns[i + 1] ?? null);
      await scheduleNext(i + (consumedNext ? 2 : 1));
    }).done;
  }

  /* ------------------------------------------------------------ */
  /* Habla del agente (chunks) + barge-in                          */
  /* ------------------------------------------------------------ */

  /** Corta a mitad de palabra para agent_text_cut ("…de tres cuar—"). */
  function cutText(spoken) {
    const t = String(spoken ?? '').trim();
    if (!t) return '';
    const words = t.split(' ');
    const last = words.pop() ?? '';
    return [...words, last.slice(0, Math.max(2, Math.ceil(last.length / 2))) + '—'].join(' ');
  }

  /**
   * Emite agent_turn_text por chunks de ~3 palabras. Si `interruptedBy` trae un
   * turno del guion con interrupt:true, corta al ~55% y emite barge_in
   * (latencia 250–400 ms). No emite agent_turn_end si fue interrumpido: el
   * turno lo cierra el engine al procesar barge_in.
   */
  async function speakChunks(text, { interruptedBy = null } = {}) {
    const words = String(text).split(/\s+/).filter(Boolean);
    const chunks = [];
    for (let i = 0; i < words.length; i += 3) chunks.push(words.slice(i, i + 3).join(' '));
    const cutIdx = interruptedBy ? Math.max(1, Math.round(chunks.length * 0.55)) : Infinity;
    let spoken = '';
    const ctx = { cancelled: false, spoken: '' };
    speechCtx = ctx;
    try {
      for (let i = 0; i < chunks.length; i++) {
        if (ctx.cancelled) return { interrupted: true, manual: true };
        if (i === cutIdx) {
          const latency = 250 + Math.round(rng() * 150);
          const cut = cutText(spoken);
          await schedule(latency, async () => {
            emit('barge_in', {
              agent_text_cut: cut,
              user_text: interruptedBy.as_heard ?? interruptedBy.text ?? '',
              latency_ms: latency,
            });
          }).done;
          return { interrupted: true };
        }
        spoken += (i ? ' ' : '') + chunks[i];
        ctx.spoken = spoken;
        await schedule(260 + rng() * 90, async () => {
          emit('agent_turn_text', { text: `${chunks[i]} ` });
        }).done;
      }
      emit('agent_turn_end', { text });
      return { interrupted: false };
    } finally {
      if (speechCtx === ctx) speechCtx = null;
    }
  }

  /** Botón "Wait!": interrumpe el habla en curso y procesa el texto. */
  function manualInterrupt(text) {
    const userText = text || 'Wait!';
    if (speechCtx && !speechCtx.cancelled) {
      const cut = cutText(speechCtx.spoken || '…');
      speechCtx.cancelled = true;
      emit('barge_in', { agent_text_cut: cut, user_text: userText, latency_ms: 260 });
      schedule(150, async () => {
        emit('user_turn_start', {});
        emit('user_turn_end', { text: userText });
        await respond(userText, null);
      });
    } else {
      overrideNext = userText; // no hay habla en curso: entra como turno libre
    }
  }

  /* ------------------------------------------------------------ */
  /* Turnos                                                        */
  /* ------------------------------------------------------------ */

  async function userSpeak(text) {
    emit('user_turn_start', {});
    await schedule(3000 + rng() * 3000, async () => {
      emit('user_turn_end', { text });
    }).done;
  }

  async function respond(text, nextTurn) {
    return schedule(300 + rng() * 600, async () => {
      emit('agent_turn_start', {});
      return processAndSpeak(text, nextTurn);
    }).done;
  }

  /** Procesa el texto oído + produce el turno del agente. */
  async function processAndSpeak(text, nextTurn) {
    const res = await decide(text, nextTurn);
    if (res?.interrupted && nextTurn) {
      // el barge-in consumió el turno siguiente del guion: procesarlo ya
      if (pendingConfirm) emitPendingConfirm();
      const heard = nextTurn.as_heard ?? nextTurn.text;
      await userSpeak(heard);
      await respond(heard, null);
      return { consumedNext: true };
    }
    if (pendingConfirm) emitPendingConfirm();
    return { consumedNext: false };
  }

  /** confirm_request justo tras agent_turn_end (§6: después del turno).
   *  Se emite SÍNCRONO (sin schedule) para que el t_ms base del siguiente
   *  turno no dependa del modo de ejecución (instant vs realtime). */
  let confirmEmittedFor = null;
  function emitPendingConfirm() {
    const pc = pendingConfirm;
    if (!pc || confirmEmittedFor === pc) return;
    confirmEmittedFor = pc;
    emit('confirm_request', {
      field: 'pieza',
      value: { sku: pc.captured.pieza.sku, nombre: pc.captured.pieza.nombre, qty: pc.captured.qty },
    });
  }

  /* ------------------------------------------------------------ */
  /* Máquina de estados del entrevistador (prioridad fija)          */
  /* ------------------------------------------------------------ */

  async function decide(text, nextTurn) {
    const bt = esBridge(text); // decoders compartidos ES: decisiones sobre el puente EN→ES
    if (pendingConfirm) return confirmFlow(text, bt, nextTurn);    // 1. read-back pendiente
    if (!st.ordenCargada) return ordenFlow(text, nextTurn);        // 2. orden
    if (!st.problemaSet) return problemaFlow(text, nextTurn);      // 3. problema
    const min = parseMinutes(bt);
    if (min != null && !st.enviado) return tiempoFlow(text, min, nextTurn); // 4. tiempo
    if (solutionVerbsEn(text) && !st.solucionSet && !st.enviado) return solucionFlow(text, nextTurn); // 5. solución
    const nota = extractNotasEn(text);                             // 6. nota (no excluyente)
    if (nota) await callTool('set_notes', { texto: nota });
    if (detectSendEn(text) && !st.enviado) return cierreFlow(text, nextTurn); // 7. envío
    if (detectPartMention(bt) && !st.enviado) return partFlow(text, bt, nextTurn); // 8. pieza
    if (!st.diagnosticoSet) return diagnosticoFlow(text, nextTurn);// 9. diagnóstico
    await speakChunks("Got it, I'm listening. What else should I add to the form?", // 10. fallback
      { interruptedBy: interruptOf(nextTurn) });
    return { interrupted: false };
  }

  /* --------------------------- flows --------------------------- */

  async function ordenFlow(text, nextTurn) {
    const r = await callTool('get_order', { orden_id: guion.order_id ?? text.match(/OT-\d+/)?.[0] ?? '' });
    if (r.ok !== false && r.orden) {
      orden = r.orden; st.ordenCargada = true;
      await speakChunks(
        `OK, I've got order ${orden.id} for ${orden.cliente}: ${orden.problema_reportado}. ` +
        "Tell me what you're finding right now.", { interruptedBy: interruptOf(nextTurn) },
      );
    } else {
      await speakChunks("I couldn't find that order. Can you repeat the number? It's OT plus four digits.",
        { interruptedBy: interruptOf(nextTurn) });
    }
    return { interrupted: false };
  }

  async function problemaFlow(text, nextTurn) {
    await callTool('set_problem', { texto: text });
    st.problemaSet = true;
    await speakChunks('Noted exactly as you said it. What are you finding when you check the equipment?',
      { interruptedBy: interruptOf(nextTurn) });
    return { interrupted: false };
  }

  async function diagnosticoFlow(text, nextTurn) {
    await callTool('set_diagnosis', { texto: text });
    st.diagnosticoSet = true;
    await speakChunks("OK. Which parts are we changing? Name them and I'll look them up.",
      { interruptedBy: interruptOf(nextTurn) });
    return { interrupted: false };
  }

  async function partFlow(text, bt, nextTurn) {
    if (!st.diagnosticoSet) {
      await callTool('set_diagnosis', { texto: text });
      st.diagnosticoSet = true;
    }
    await pause(150 + rng() * 60); // fin-de-habla → tool call (métrica de latencia)
    const r = await callTool('search_part', { consulta: text }); // evidencia EN cruda
    if (!r.best) {
      await speakChunks("I can't find that one in the catalog. What does the supplier call it, exactly?",
        { interruptedBy: interruptOf(nextTurn) });
      return { interrupted: false };
    }
    const qty = r.best.qty_hint ?? parseQty(bt).qty;
    const added = await callTool('add_part_to_report', { sku: r.best.sku, qty });
    if (!added || added.ok === false) {
      await speakChunks("I couldn't add that part. Let me retry with the catalog SKU.",
        { interruptedBy: interruptOf(nextTurn) });
      return { interrupted: false };
    }
    addedSkus.set(r.best.sku, bySku.get(r.best.sku) ?? { sku: r.best.sku, nombre: r.best.nombre, unidad: 'pza' });
    const pieza = addedSkus.get(r.best.sku);
    const sibling = r.confusable_warning?.sku ? bySku.get(r.confusable_warning.sku) : null;
    let speech;
    if (sibling) {
      pendingConfirm = { kind: 'disambiguation', captured: { pieza, qty }, sibling };
      speech = `Careful, these two get mixed up easily. Did you mean ${speakNombreEn(pieza.nombre)}, ` +
        `or ${speakNombreEn(sibling.nombre)}?`;
    } else {
      pendingConfirm = { kind: 'plain', captured: { pieza, qty }, sibling: null };
      speech = `Noting ${speakNombreEn(pieza.nombre)}, ${speakQtyEn(qty, pieza.unidad)}. Correct?`;
    }
    const res = await speakChunks(speech, { interruptedBy: interruptOf(nextTurn) });
    return { interrupted: res.interrupted };
  }

  async function confirmFlow(text, bt, nextTurn) {
    const pc = pendingConfirm;
    const conf = detectConfirm(text);
    /* 1. "no, it was the half-inch one": corrección hacia OTRA pieza del mismo
          tipo con dimensión explícita en el texto (aunque no sea el par). */
    if (conf === 'no') {
      const cand = findSameTipoCorrection(bt, pc);
      if (cand) return correctionFlow(pc, cand, text, bt, nextTurn);
    }
    /* 2. desambiguación entre el par capturado/sibling */
    if (pc.kind === 'disambiguation' && pc.sibling) {
      const selA = mentionsAny(bt, distinguisherTokens(pc.captured.pieza, pc.sibling));
      const selB = mentionsAny(bt, distinguisherTokens(pc.sibling, pc.captured.pieza));
      const lastA = selA ? lastMention(bt, selA) : -1;
      const lastB = selB ? lastMention(bt, selB) : -1;
      if (lastB > lastA) return correctionFlow(pc, pc.sibling, text, bt, nextTurn);
      if (lastA >= 0 || conf === 'yes') return confirmOkFlow(pc, nextTurn);
      return reaskFlow(pc, nextTurn);
    }
    if (conf === 'yes') return confirmOkFlow(pc, nextTurn);
    if (conf === 'no') {
      const r = await callTool('search_part', { consulta: text });
      const nueva = r.best && r.best.sku !== pc.captured.pieza.sku ? bySku.get(r.best.sku) : null;
      if (nueva) return correctionFlow(pc, nueva, text, bt, nextTurn);
      return reaskFlow(pc, nextTurn);
    }
    return reaskFlow(pc, nextTurn);
  }

  /**
   * Busca en el catálogo una pieza del MISMO tipo que la capturada (excluyendo
   * al sibling del par) cuya dimensión distintiva aparezca explícita en el
   * texto. Es lo que rescata el caso s3: capturada 3/4 (sibling 3/8) y el
   * técnico corrige a "la de media pulgada".
   */
  function findSameTipoCorrection(text, pc) {
    for (const p of piezas) {
      if (p.tipo !== pc.captured.pieza.tipo) continue;
      if (p.sku === pc.captured.pieza.sku) continue;
      if (pc.sibling && p.sku === pc.sibling.sku) continue;
      const d = distinguisherTokens(p, pc.captured.pieza);
      if (mentionsAny(text, d)) return p;
    }
    return null;
  }

  async function confirmOkFlow(pc, nextTurn) {
    emit('confirm_result', {
      field: 'pieza',
      value: { sku: pc.captured.pieza.sku, qty: pc.captured.qty },
      confirmed: true,
    });
    confirmedSkus.add(pc.captured.pieza.sku);
    pendingConfirm = null;
    await speakChunks(
      `Confirmed: ${speakNombreEn(pc.captured.pieza.nombre)}, ` +
      `${speakQtyEn(pc.captured.qty, pc.captured.pieza.unidad)}. What else are we changing, or how did the job turn out?`,
      { interruptedBy: interruptOf(nextTurn) },
    );
    return { interrupted: false };
  }

  async function correctionFlow(pc, nueva, text, bt, nextTurn) {
    emit('confirm_result', {
      field: 'pieza',
      value: { sku: pc.captured.pieza.sku, qty: pc.captured.qty },
      confirmed: false,
    });
    const q = parseQty(bt);
    const qty = q.explicit ? q.qty : pc.captured.qty;
    await callTool('add_part_to_report', { sku: nueva.sku, qty });
    addedSkus.set(nueva.sku, nueva);
    pendingConfirm = { kind: 'plain', captured: { pieza: nueva, qty }, sibling: null };
    await speakChunks(
      `Fixed: ${speakNombreEn(nueva.nombre)}, ${speakQtyEn(qty, nueva.unidad)}. Shall I confirm now?`,
      { interruptedBy: interruptOf(nextTurn) },
    );
    return { interrupted: false };
  }

  async function reaskFlow(pc, nextTurn) {
    const speech = pc.kind === 'disambiguation' && pc.sibling
      ? `I didn't get that. Is it ${speakNombreEn(pc.captured.pieza.nombre)}, or ${speakNombreEn(pc.sibling.nombre)}?`
      : `Shall I confirm ${speakNombreEn(pc.captured.pieza.nombre)}, ` +
        `${speakQtyEn(pc.captured.qty, pc.captured.pieza.unidad)}?`;
    await speakChunks(speech, { interruptedBy: interruptOf(nextTurn) });
    pendingConfirm = { ...pc }; // nuevo objeto → nuevo confirm_request en el artefacto
    return { interrupted: false };
  }

  async function tiempoFlow(text, min, nextTurn) {
    if (solutionVerbsEn(text) && !st.solucionSet) {
      await callTool('set_solution', { texto: text });
      st.solucionSet = true;
    }
    const r = await callTool('get_work_time', { minutos: min });
    st.tiempoSet = true;
    await speakChunks(
      `Logging ${r.minutos ?? min} minutes of work. ` +
      (st.solucionSet ? 'Anything else to add to the form?' : 'How did the job turn out?'),
      { interruptedBy: interruptOf(nextTurn) },
    );
    return { interrupted: false };
  }

  async function solucionFlow(text, nextTurn) {
    await callTool('set_solution', { texto: text });
    st.solucionSet = true;
    await speakChunks('Noted, solution saved. How long have you been on this job?',
      { interruptedBy: interruptOf(nextTurn) });
    return { interrupted: false };
  }

  async function cierreFlow(text, nextTurn) {
    if (!st.solucionSet) {
      const synth = synthSolution();
      if (synth) { await callTool('set_solution', { texto: synth }); st.solucionSet = true; }
    }
    if (!st.tiempoSet) {
      const r = await callTool('get_work_time', {});
      st.tiempoSet = true;
      await speakChunks(`You're at ${r.minutos ?? 0} minutes logged.`, { interruptedBy: null });
    }
    const r = await callTool('send_report', {});
    st.enviado = true;
    emit('report_sent', {}); // síncrono: sin drift de t_ms entre instant/realtime
    await speakChunks(
      r?.resumen
        ? `Report sent: ${r.resumen.piezas} part${r.resumen.piezas === 1 ? '' : 's'}, ` +
          `${r.resumen.tiempo_minutos ?? 0} minutes. Great work — close it out well.`
        : 'Report sent. Great work.',
      { interruptedBy: interruptOf(nextTurn) },
    );
    schedule(400, async () => doStop());
    return { interrupted: false };
  }

  /** Solución sintetizada cuando el técnico nunca la narró completa (s3). */
  function synthSolution() {
    const ok = [...addedSkus.values()].filter((p) => confirmedSkus.has(p.sku));
    if (!ok.length) return null;
    return `Swapped in ${ok.map((p) => speakNombreEn(p.nombre).toLowerCase()).join(' and ')}. The equipment is running again.`;
  }

  function interruptOf(nextTurn) {
    return nextTurn && nextTurn.interrupt ? nextTurn : null;
  }

  function lastMention(text, token) {
    const toks = normalizeText(text).split(' ');
    for (let i = toks.length - 1; i >= 0; i--) if (toks[i] === token) return i;
    return -1;
  }

  function solutionVerbs(text) {
    return /\b(cambie|cambiamos|quedo|arregle|repare|sustitu|saque|rellene|aprete|limpie|instale|puse)\b/
      .test(normalizeText(text));
  }

  /* ------------------------------------------------------------------ */
  /* Capa EN: confirmaciones / envío / notas / verbos-solución /          */
  /* read-back de nombres y cantidades. Evidencia EN TAL CUAL en tools.  */
  /* ------------------------------------------------------------------ */

  /**
   * Confirmación hablada POR CLÁUSULAS (dual-accept ES+EN, patrón del dominio
   * incidente): la respuesta va en la PRIMERA cláusula y el resto del turno es
   * dictado nuevo; un "no" cuenta solo cuando ABRE una cláusula. La base ES
   * (detectConfirmation) sigue aceptando "sí"/"correcto" — p. ej. el botón ✅
   * de la UI manda 'sí' — y la capa EN agrega yes/nope/that one. MISMO parser
   * para la vía replay (guion) y la vía user_text del input: ambas pasan por
   * decide() → confirmFlow.
   */
  function detectConfirm(text) {
    const clauses = String(text ?? '')
      .split(/(?:\.\.\.|[.,;!?])/)
      .map((s) => s.trim())
      .filter(Boolean);
    const first = clauses[0] ?? '';
    const base = detectConfirmation(first);
    if (base) return base;
    const f = stripAccents(first).toLowerCase();
    if (/\b(esa|ese|eso|asi va|asi esta|asi queda|con eso|va)\b/.test(f)) return 'yes';
    if (/\b(yes|yeah|yep|correct|right|exactly|sure|fine|perfect|affirmative)\b/.test(f)
      || /\bthat'?s (?:it|right|fine|good|correct)\b/.test(f)
      || /\bthat one\b/.test(f)) return 'yes';
    for (const c of clauses) {
      if (/^\s*(no|nope|negativo|negative|espera|alto|cambio|wrong|wait|hold on|hang on|change|incorrect|actually|never mind|not that one|equivocad\w*)\b/i.test(c)) return 'no';
    }
    return null;
  }

  /** Envío EN: "send it", "submit", "good to go", "done". Base ES primero. */
  function detectSendEn(text) {
    if (detectSend(text)) return true;
    return /\b(?:send\w*|submit\w*|good to go|done)\b/.test(normalizeText(String(text ?? '')));
  }

  /**
   * Nota final EN ("note that …"); base ES primero. La nota queda en EN tal
   * cual (evidencia textual de la ficha).
   */
  function extractNotasEn(text) {
    const es = extractNotas(text);
    if (es) return es;
    const m = String(text ?? '')
      .match(/(?:\bnote|\bjot down|\bput down|\bwrite down)\s+that\s+(.+)$/is);
    if (!m) return null;
    let nota = m[1]
      .replace(/\s*[.,;]*\s*(?:that'?s all|that is all|send it|done deal)[\s\S]*$/i, '');
    nota = nota.replace(/\s*\.{2,}\s*$/, '').replace(/[.,;]\s*$/, '').trim();
    return nota.length >= 3 ? nota : null;
  }

  /**
   * Verbos de solución EN (cambio/reparación consumada). Sin 'put'/'repair' a
   * secas: "log an hour" (s3) y "beyond repair" (s3) NO son solución; sí lo
   * son "kicked on", "changed", "refilled", "bled" (s1/s2).
   */
  function solutionVerbsEn(text) {
    if (solutionVerbs(text)) return true;
    return /\b(?:chang\w+|replac\w+|swapped|fixed|repaired|cleaned|tightened|refilled|purg\w+|bled|install\w+|kick\w+)\b/
      .test(normalizeText(esBridge(text)));
  }

  /** Frases del catálogo ES→EN para el read-back (nombres congelados en ES). */
  const NOMBRE_EN = [
    [/\bv[áa]lvula de bola lat[óo]n\b/gi, 'Brass ball valve'],
    [/\bmanguera de neopreno reforzada\b/gi, 'Reinforced neoprene hose'],
    [/\bcapacitor de arranque\b/gi, 'Start capacitor'],
    [/\bcapacitor de marcha\b/gi, 'Run capacitor'],
    [/\bbreaker termomagn[ée]tico\b/gi, 'Thermal-magnetic breaker'],
    [/\btramo 1 m\b/gi, 'one-meter length'],
    [/µf/gi, 'microfarad'], // µ no es \w: \b no aplica
    [/\bpolos\b/gi, 'pole'],
    [/\bbobina\b/gi, 'coil'],
    [/\bv\b/gi, 'volt'],
  ];

  const FRACTION_SPEECH_EN = {
    '3/4': 'THREE QUARTERS', '3/8': 'THREE EIGHTHS', '1/2': 'HALF INCH',
    '5/8': 'FIVE EIGHTHS', '1/4': 'ONE QUARTER',
    '45+5': 'FORTY-FIVE PLUS FIVE', '35+5': 'THIRTY-FIVE PLUS FIVE',
  };
  const NUM_SPEECH_EN = ['ZERO', 'ONE', 'TWO', 'THREE', 'FOUR', 'FIVE', 'SIX', 'SEVEN',
    'EIGHT', 'NINE', 'TEN', 'ELEVEN', 'TWELVE', 'THIRTEEN', 'FOURTEEN', 'FIFTEEN',
    'SIXTEEN', 'SEVENTEEN', 'EIGHTEEN', 'NINETEEN', 'TWENTY'];
  const TENS_SPEECH_EN = {
    2: 'TWENTY', 3: 'THIRTY', 4: 'FORTY', 5: 'FIFTY', 6: 'SIXTY',
    7: 'SEVENTY', 8: 'EIGHTY', 9: 'NINETY',
  };

  /** Dígito/número del nombre → palabras para el read-back en voz alta. */
  function speakDigitEn(nStr) {
    const n = Number(nStr);
    if (Number.isInteger(n) && n >= 0 && n <= 20) return NUM_SPEECH_EN[n];
    if (Number.isInteger(n) && n >= 21 && n <= 99 && n % 10 === 0) return TENS_SPEECH_EN[n / 10];
    if (Number.isInteger(n) && n >= 21 && n <= 99) return `${TENS_SPEECH_EN[Math.floor(n / 10)]}-${NUM_SPEECH_EN[n % 10]}`;
    if (n === 125) return 'ONE TWENTY-FIVE';
    if (n === 370) return 'THREE SEVENTY';
    if (n === 440) return 'FOUR FORTY';
    if (n === 450) return 'FOUR FIFTY';
    if (n === 455) return 'FOUR FIFTY-FIVE';
    return String(nStr); // fuera de tabla: tal cual (determinista)
  }

  /** Read-back EN del nombre de catálogo (ES congelado). Fallback: ES. */
  function speakNombreEn(nombre) {
    let out = String(nombre ?? '');
    let hit = false;
    for (const [re, en] of NOMBRE_EN) out = out.replace(re, () => { hit = true; return en; });
    if (!hit) return speakNombre(out); // fuera de tabla: read-back ES del compartido
    return out
      .replace(/(\d+\+\d+|\d+\/\d+|\d+\.\d+|\b\d+\b)/g, (m) => FRACTION_SPEECH_EN[m] ?? speakDigitEn(m))
      .replace(/\s*"\s*$/, '')
      .replace(/\s{2,}/g, ' ')
      .trim();
  }

  /** Read-back EN de la cantidad ("two pieces", "one set", "one meter"). */
  function speakQtyEn(qty, unidad = 'pza') {
    const noun = unidad === 'jgo' ? 'set' : unidad === 'm' ? 'meter' : 'piece';
    const n = speakDigitEn(qty).toLowerCase();
    return `${n} ${noun}${qty > 1 ? 's' : ''}`;
  }

  async function playUserTurn(turn, nextTurn) {
    const heard = turn.as_heard ?? turn.text;
    await userSpeak(heard);
    const res = await respond(heard, nextTurn);
    return !!res?.consumedNext;
  }

  return api;
}

/* ------------------------------------------------------------------ */
/* PRNG determinista + hash de strings                                 */
/* ------------------------------------------------------------------ */

/** mulberry32 — PRNG sembrado, determinista (seed fija por escenario). */
export function mulberry32(a) {
  let t = a >>> 0;
  return function next() {
    t |= 0; t = (t + 0x6D2B79F5) | 0;
    let x = Math.imul(t ^ (t >>> 15), 1 | t);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

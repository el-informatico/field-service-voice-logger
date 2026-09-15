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
  parseQty, distinguisherTokens, mentionsAny, speakNombre, speakQty, normalizeText,
} from './dialog-act.js';

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

  /** Botón "¡Espera!": interrumpe el habla en curso y procesa el texto. */
  function manualInterrupt(text) {
    const userText = text || '¡Espera!';
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
    if (pendingConfirm) return confirmFlow(text, nextTurn);        // 1. read-back pendiente
    if (!st.ordenCargada) return ordenFlow(text, nextTurn);        // 2. orden
    if (!st.problemaSet) return problemaFlow(text, nextTurn);      // 3. problema
    const min = parseMinutes(text);
    if (min != null && !st.enviado) return tiempoFlow(text, min, nextTurn); // 4. tiempo
    if (solutionVerbs(text) && !st.solucionSet && !st.enviado) return solucionFlow(text, nextTurn); // 5. solución
    const nota = extractNotas(text);                               // 6. nota (no excluyente)
    if (nota) await callTool('set_notas', { texto: nota });
    if (detectSend(text) && !st.enviado) return cierreFlow(text, nextTurn); // 7. envío
    if (detectPartMention(text) && !st.enviado) return partFlow(text, nextTurn); // 8. pieza
    if (!st.diagnosticoSet) return diagnosticoFlow(text, nextTurn);// 9. diagnóstico
    await speakChunks('Va, te escucho. ¿Qué más encuentro para la ficha?', // 10. fallback
      { interruptedBy: interruptOf(nextTurn) });
    return { interrupted: false };
  }

  /* --------------------------- flows --------------------------- */

  async function ordenFlow(text, nextTurn) {
    const r = await callTool('get_orden', { orden_id: guion.order_id ?? text.match(/OT-\d+/)?.[0] ?? '' });
    if (r.ok !== false && r.orden) {
      orden = r.orden; st.ordenCargada = true;
      await speakChunks(
        `Va, ya tengo la orden ${orden.id} de ${orden.cliente}: ${orden.problema_reportado}. ` +
        'Cuéntame qué encuentras ahorita.', { interruptedBy: interruptOf(nextTurn) },
      );
    } else {
      await speakChunks('No encontré esa orden. ¿Me repites el número? Es OT y cuatro dígitos.',
        { interruptedBy: interruptOf(nextTurn) });
    }
    return { interrupted: false };
  }

  async function problemaFlow(text, nextTurn) {
    await callTool('set_problema', { texto: text });
    st.problemaSet = true;
    await speakChunks('Anotado tal cual lo dijiste. ¿Qué encuentras al revisar el equipo?',
      { interruptedBy: interruptOf(nextTurn) });
    return { interrupted: false };
  }

  async function diagnosticoFlow(text, nextTurn) {
    await callTool('set_diagnostico', { texto: text });
    st.diagnosticoSet = true;
    await speakChunks('Va. ¿Qué piezas se cambian? Dímelas por su nombre y te las busco.',
      { interruptedBy: interruptOf(nextTurn) });
    return { interrupted: false };
  }

  async function partFlow(text, nextTurn) {
    if (!st.diagnosticoSet) {
      await callTool('set_diagnostico', { texto: text });
      st.diagnosticoSet = true;
    }
    await pause(150 + rng() * 60); // fin-de-habla → tool call (métrica de latencia)
    const r = await callTool('buscar_pieza', { consulta: text });
    if (!r.best) {
      await speakChunks('Esa no la encuentro en el catálogo. ¿Cómo la llama el proveedor, exactamente?',
        { interruptedBy: interruptOf(nextTurn) });
      return { interrupted: false };
    }
    const qty = r.best.qty_hint ?? parseQty(text).qty;
    const added = await callTool('agregar_pieza_a_reporte', { sku: r.best.sku, qty });
    if (!added || added.ok === false) {
      await speakChunks('No pude agregar esa pieza. Déjame reintentar con el SKU del catálogo.',
        { interruptedBy: interruptOf(nextTurn) });
      return { interrupted: false };
    }
    addedSkus.set(r.best.sku, bySku.get(r.best.sku) ?? { sku: r.best.sku, nombre: r.best.nombre, unidad: 'pza' });
    const pieza = addedSkus.get(r.best.sku);
    const sibling = r.confusable_warning?.sku ? bySku.get(r.confusable_warning.sku) : null;
    let speech;
    if (sibling) {
      pendingConfirm = { kind: 'disambiguation', captured: { pieza, qty }, sibling };
      speech = `Ojo, aquí se confunden fácil. ¿Decías ${speakNombre(pieza.nombre)}, ` +
        `o ${speakNombre(sibling.nombre)}?`;
    } else {
      pendingConfirm = { kind: 'plain', captured: { pieza, qty }, sibling: null };
      speech = `Anoto ${speakNombre(pieza.nombre)}, ${speakQty(qty, pieza.unidad)}. ¿Correcto?`;
    }
    const res = await speakChunks(speech, { interruptedBy: interruptOf(nextTurn) });
    return { interrupted: res.interrupted };
  }

  async function confirmFlow(text, nextTurn) {
    const pc = pendingConfirm;
    const conf = detectConfirmation(text);
    /* 1. "no, era la de 1/2": corrección hacia OTRA pieza del mismo tipo con
          dimensión explícita en el texto (aunque no sea el par confundible). */
    if (conf === 'no') {
      const cand = findSameTipoCorrection(text, pc);
      if (cand) return correctionFlow(pc, cand, text, nextTurn);
    }
    /* 2. desambiguación entre el par capturado/sibling */
    if (pc.kind === 'disambiguation' && pc.sibling) {
      const selA = mentionsAny(text, distinguisherTokens(pc.captured.pieza, pc.sibling));
      const selB = mentionsAny(text, distinguisherTokens(pc.sibling, pc.captured.pieza));
      const lastA = selA ? lastMention(text, selA) : -1;
      const lastB = selB ? lastMention(text, selB) : -1;
      if (lastB > lastA) return correctionFlow(pc, pc.sibling, text, nextTurn);
      if (lastA >= 0 || conf === 'yes') return confirmOkFlow(pc, nextTurn);
      return reaskFlow(pc, nextTurn);
    }
    if (conf === 'yes') return confirmOkFlow(pc, nextTurn);
    if (conf === 'no') {
      const r = await callTool('buscar_pieza', { consulta: text });
      const nueva = r.best && r.best.sku !== pc.captured.pieza.sku ? bySku.get(r.best.sku) : null;
      if (nueva) return correctionFlow(pc, nueva, text, nextTurn);
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
      `Queda confirmada: ${speakNombre(pc.captured.pieza.nombre)}, ` +
      `${speakQty(pc.captured.qty, pc.captured.pieza.unidad)}. ¿Qué más se cambia, o cómo quedó el trabajo?`,
      { interruptedBy: interruptOf(nextTurn) },
    );
    return { interrupted: false };
  }

  async function correctionFlow(pc, nueva, text, nextTurn) {
    emit('confirm_result', {
      field: 'pieza',
      value: { sku: pc.captured.pieza.sku, qty: pc.captured.qty },
      confirmed: false,
    });
    const q = parseQty(text);
    const qty = q.explicit ? q.qty : pc.captured.qty;
    await callTool('agregar_pieza_a_reporte', { sku: nueva.sku, qty });
    addedSkus.set(nueva.sku, nueva);
    pendingConfirm = { kind: 'plain', captured: { pieza: nueva, qty }, sibling: null };
    await speakChunks(
      `Corrijo: ${speakNombre(nueva.nombre)}, ${speakQty(qty, nueva.unidad)}. ¿Ahora sí confirmo?`,
      { interruptedBy: interruptOf(nextTurn) },
    );
    return { interrupted: false };
  }

  async function reaskFlow(pc, nextTurn) {
    const speech = pc.kind === 'disambiguation' && pc.sibling
      ? `No te entendí. ¿Es ${speakNombre(pc.captured.pieza.nombre)} o ${speakNombre(pc.sibling.nombre)}?`
      : `¿Confirmo ${speakNombre(pc.captured.pieza.nombre)}, ` +
        `${speakQty(pc.captured.qty, pc.captured.pieza.unidad)}?`;
    await speakChunks(speech, { interruptedBy: interruptOf(nextTurn) });
    pendingConfirm = { ...pc }; // nuevo objeto → nuevo confirm_request en el artefacto
    return { interrupted: false };
  }

  async function tiempoFlow(text, min, nextTurn) {
    if (solutionVerbs(text) && !st.solucionSet) {
      await callTool('set_solucion', { texto: text });
      st.solucionSet = true;
    }
    const r = await callTool('get_tiempo_trabajo', { minutos: min });
    st.tiempoSet = true;
    await speakChunks(
      `Anoto ${r.minutos ?? min} minutos de trabajo. ` +
      (st.solucionSet ? '¿Algo más que agregar a la ficha?' : '¿Cómo quedó el trabajo?'),
      { interruptedBy: interruptOf(nextTurn) },
    );
    return { interrupted: false };
  }

  async function solucionFlow(text, nextTurn) {
    await callTool('set_solucion', { texto: text });
    st.solucionSet = true;
    await speakChunks('Va, anotada la solución. ¿Cuánto tiempo llevas en este trabajo?',
      { interruptedBy: interruptOf(nextTurn) });
    return { interrupted: false };
  }

  async function cierreFlow(text, nextTurn) {
    if (!st.solucionSet) {
      const synth = synthSolution();
      if (synth) { await callTool('set_solucion', { texto: synth }); st.solucionSet = true; }
    }
    if (!st.tiempoSet) {
      const r = await callTool('get_tiempo_trabajo', {});
      st.tiempoSet = true;
      await speakChunks(`Te llevo ${r.minutos ?? 0} minutos anotados.`, { interruptedBy: null });
    }
    const r = await callTool('enviar_reporte', {});
    st.enviado = true;
    emit('report_sent', {}); // síncrono: sin drift de t_ms entre instant/realtime
    await speakChunks(
      r?.resumen
        ? `Ficha enviada: ${r.resumen.piezas} pieza${r.resumen.piezas === 1 ? '' : 's'}, ` +
          `${r.resumen.tiempo_minutos ?? 0} minutos. Buen trabajo, cierra bien.`
        : 'Ficha enviada. Buen trabajo.',
      { interruptedBy: interruptOf(nextTurn) },
    );
    schedule(400, async () => doStop());
    return { interrupted: false };
  }

  /** Solución sintetizada cuando el técnico nunca la narró completa (s3). */
  function synthSolution() {
    const ok = [...addedSkus.values()].filter((p) => confirmedSkus.has(p.sku));
    if (!ok.length) return null;
    return `Se cambiaron ${ok.map((p) => p.nombre.toLowerCase()).join(' y ')}. El equipo quedó funcionando.`;
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

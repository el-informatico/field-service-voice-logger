/**
 * mock-agent.js (incidente) — canal MOCK del entrevistador de incidentes:
 * determinista por reglas (sin LLM). ESM, sin dependencias, DOM-free.
 *
 * Implementa la MISMA interfaz de Canal que web/js/mock-agent.js (orden):
 *   on(type, fn) → unsubscribe     eventos hacia engine/UI (vocabulario en web/README.md)
 *   send(type, data)               engine→canal: tool_result | advance | user_text
 *                                  | interrupt_request | stop
 *   start(): Promise<void>         resuelve al terminar la sesión (ended)
 *   stop() / clock                 simClock determinista (fuente de t_ms)
 *
 * Flujo del dominio incidente (contrato §1: dictado POST-VISITA, ambiente
 * tranquilo): get_incidente → pide qué pasó → set_que_paso → extrae eventos
 * con horas (agregar_evento_timeline + read-back de CADA hora) → servicios
 * mencionados (buscar_servicio → read-back de desambiguación nombrando AMBOS
 * si hay par confundible → agregar_servicio) → severidad (set_severidad +
 * read-back SIEMPRE) → action items → enviar_reporte.
 *
 * Capa de DIRECTIVAS de guion: los turnos agent de data/guiones-incidente/
 * llevan en `hint` y en campos estructurados (add_evento, add_servicios,
 * correct_to) los valores exactos que la ficha debe capturar. Al responder al
 * turno user n, este canal ejecuta las directivas del turno agent n+1; las
 * REGLAS cubren lo demás (entrada libre del input de la UI, sesiones sin
 * guion) con el mismo árbol de prioridades. Así el replay calza la ficha con
 * el ground-truth EXACTO sin hardcodear escenarios. En los read-backs de
 * desambiguación, si hay turno agent de guion la directiva correct_to manda
 * (el operador puede nombrar al hermano para EXCLUIRLO, p. ej. "la
 * secundaria ni se tocó") y la heurística de última mención queda solo para
 * entrada libre.
 *
 * Reglas del juego (idénticas al mock de orden):
 *  - NO toca el store: TODO pasa por tool_call/tool_result (el engine ejecuta
 *    contra el tool-runner del dominio). El loop de confirmación de servicios
 *    viaja por las tools internas confirmar_servicio/quitar_servicio (el
 *    session-engine compartido solo aplica markConfirmada a field='pieza').
 *  - Replay: cada turno user puede llevar `as_heard` (transcripción mal oída)
 *    e `interrupt:true` (barge-in). Si un read-back es interrumpido, la
 *    pregunta queda registrada (confirm_request) pero sin espera: el valor
 *    capturado se mantiene y el flujo atiende al operador de inmediato.
 *  - Pacing determinista: PRNG mulberry32 con seed fija por escenario → los
 *    t_ms del artefacto son idénticos entre corridas. `speed` = 1 tiempo real
 *    (demo en browser), speed = Infinity instantáneo (CI/headless).
 */
import { simClock } from '../../clock.js';
import {
  detectConfirmation, detectSend, normalizeText, tokenSet, mentionsAny, stripAccents,
} from '../../dialog-act.js';
import {
  parseHoras, parseSeveridad, extractActionItem,
  scoreServicios, speakHora, speakServicioNombre,
} from './dialog.js';
import { parseAgentDirectives } from './guion-directives.js';

const EMPTY_DIRECTIVES = {
  hasAgentTurn: false,
  getIncidente: null,
  setQuePaso: false,
  eventos: [],
  buscar: null,
  addServicios: [],
  correctServicio: null,
  correctHora: null,
  setSeveridad: null,
  actionItems: [],
  enviar: false,
  resumen: null,
};

export function createIncidentMockAgentChannel({
  incidentes = [], servicios = [], guion = { turns: [] }, speed = 1, seed,
} = {}) {
  /* ------------------------------------------------------------ */
  /* Infra: emitter + scheduler determinista (espejo del orden)     */
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
  const rng = mulberry32(seed ?? hashStr(String(guion.scenario_id ?? 'mock-incidente')));

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

  async function pump() {
    if (pumping) return;
    pumping = true;
    try {
      while (tasks.length && !stopped) {
        tasks.sort((a, b) => (a.at - b.at) || (a.seq - b.seq));
        let t = tasks[0];
        let budget = instant ? 0 : Math.max(0, (t.at - clock.now()) / speed);
        while (budget > 0 && !stopped) {
          const slice = Math.min(20, budget);
          await sleep(slice);
          budget -= slice;
          tasks.sort((a, b) => (a.at - b.at) || (a.seq - b.seq));
          if (tasks[0] !== t) { t = null; break; }
        }
        if (!t) continue;
        const run = tasks.shift();
        if (run !== t) { tasks.unshift(run); continue; }
        if (t.cancelled) { t.resolve(undefined); continue; }
        clock.set(t.at);
        Promise.resolve()
          .then(() => t.fn())
          .then(
            (r) => t.resolve(r),
            (err) => { console.error('[mock-incidente] task error:', err); t.resolve(undefined); },
          );
        await Promise.resolve();
      }
    } finally { pumping = false; }
    if (tasks.length && !stopped) pump();
  }

  function pause(ms) { return schedule(ms, async () => {}).done; }

  /* ------------------------------------------------------------ */
  /* Tool calls vía el protocolo del canal (nunca directo al store) */
  /* ------------------------------------------------------------ */

  let callSeq = 0;
  const pendingCalls = new Map(); // call_id → resolve
  async function callTool(tool, args) {
    const call_id = `mi${++callSeq}`;
    const p = new Promise((resolve) => pendingCalls.set(call_id, resolve));
    emit('tool_call', { call_id, tool, args });
    const out = await p;
    return out?.result ?? {};
  }

  /* ------------------------------------------------------------ */
  /* Directivas de guion: turnos agent indexados por n              */
  /* ------------------------------------------------------------ */

  const agentTurnByN = new Map(
    (guion.turns ?? []).filter((t) => t.role === 'agent').map((t) => [t.n, t]),
  );
  /** Directivas que rigen la respuesta al turno user n (agent n+1). */
  function directivesFor(userN) {
    const a = agentTurnByN.get(userN + 1);
    return a ? parseAgentDirectives(a) : null;
  }

  /* ------------------------------------------------------------ */
  /* Estado del entrevistador                                      */
  /* ------------------------------------------------------------ */

  const byId = new Map(servicios.map((s) => [s.id, s]));
  const st = {
    incidenteCargado: false, quePasoSet: false, resumenSet: false,
    severidadSet: false, enviado: false,
  };
  let incidente = null;
  let pendingConfirm = null; // {kind:'hora'|'servicio-disambiguation'|'servicio-plain'|'severidad', ...}
  const addedHoras = new Set();
  const addedServicios = new Set();
  const confirmedServicios = new Set();
  let speechCtx = null;      // {cancelled} del speakChunks en curso (botón ¡Espera!)
  let overrideNext = null;   // texto libre del input de la UI
  let autoReplay = true;
  let gate = null;           // modo manual: espera 'advance'
  const userTurns = (guion.turns ?? []).filter((t) => t.role === 'user');
  let lastUserN = 0;         // n del último turno user jugado

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
    const saludo = '¡Buen día! Soy tu asistente de incidentes. Ya tengo el contexto de tu visita: ' +
      'cuéntame con calma qué pasó y voy armando la ficha del incidente.';
    await schedule(500 + rng() * 400, async () => {
      emit('agent_turn_start', {});
      await speakChunks(saludo);
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
      // entrada libre: fuera as_heard/interrupt y fuera directivas de guion
      turn = { ...turn, n: 0, text: overrideNext, as_heard: null, interrupt: false };
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

  function cutText(spoken) {
    const t = String(spoken ?? '').trim();
    if (!t) return '';
    const words = t.split(' ');
    const last = words.pop() ?? '';
    return [...words, last.slice(0, Math.max(2, Math.ceil(last.length / 2))) + '—'].join(' ');
  }

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
      overrideNext = userText;
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

  async function processAndSpeak(text, nextTurn) {
    // El turno user n dicta; respondemos con las directivas del agent n+1
    // (con guion; sin guion, directivas vacías → solo reglas).
    const d = directivesFor(lastUserN) ?? EMPTY_DIRECTIVES;
    const res = await decide(text, d, nextTurn);
    if (res?.interrupted && nextTurn) {
      // el barge-in consumió el turno siguiente del guion: procesarlo ya
      if (pendingConfirm) emitPendingConfirm();
      pendingConfirm = null; // read-back cortado: el valor capturado se mantiene
      const heard = nextTurn.as_heard ?? nextTurn.text;
      lastUserN = nextTurn.n ?? (lastUserN + 1); // sus directivas son las del agent n+1
      await userSpeak(heard);
      await respond(heard, null);
      return { consumedNext: true };
    }
    if (pendingConfirm) emitPendingConfirm();
    return { consumedNext: false };
  }

  /** confirm_request justo tras agent_turn_end. Se emite SÍNCRONO (sin
   *  schedule) para que el t_ms base del siguiente turno no dependa del modo
   *  de ejecución (instant vs realtime). */
  let confirmEmittedFor = null;
  function emitPendingConfirm() {
    const pc = pendingConfirm;
    if (!pc || confirmEmittedFor === pc) return;
    confirmEmittedFor = pc;
    if (pc.kind === 'hora') {
      // valor escalar "HH:MM" (o arreglo si el dictado trajo varias horas):
      // es la forma del GT §6 y la que compara el harness de confirmaciones
      emit('confirm_request', { field: 'hora', value: horaValue(pc.horas) });
    } else if (pc.kind === 'severidad') {
      emit('confirm_request', { field: 'severidad', value: pc.severidad });
    } else {
      emit('confirm_request', {
        field: 'servicio',
        value: { id: pc.captured.id, nombre: pc.captured.nombre, afectados: pc.captured.afectados },
      });
    }
  }

  /** Escalar cuando hay una hora; arreglo cuando el read-back es en lote. */
  function horaValue(horas) {
    return horas.length === 1 ? horas[0] : horas;
  }

  /* ------------------------------------------------------------ */
  /* Máquina de estados (directivas primero, reglas de respaldo)    */
  /* ------------------------------------------------------------ */

  /**
   * SIDE-QUESTS de la respuesta (sin habla propia): resumen citado y action
   * items de directiva — van a la ficha pase lo que pase con el read-back.
   * Devuelve cuántos pendientes agregó.
   */
  async function applySideQuests(d) {
    if (d.resumen && !st.resumenSet) {
      const r = await callTool('set_resumen', { texto: d.resumen });
      if (r.ok !== false) st.resumenSet = true;
    }
    for (const item of d.actionItems) {
      await callTool('agregar_action_item', { descripcion: item });
    }
    return d.actionItems.length;
  }

  async function decide(text, d, nextTurn, depth = 0) {
    const nItems = await applySideQuests(d);
    if (pendingConfirm) return confirmFlow(text, d, nextTurn, depth);       // 1. read-back pendiente
    if (!st.incidenteCargado || d.getIncidente) return incidenteFlow(text, d, nextTurn); // 2. incidente
    if (!st.quePasoSet || d.setQuePaso) return quePasoFlow(text, d, nextTurn); // 3. dictado
    if (d.eventos.length || horasNuevas(text).length) {
      return eventoFlow(text, d, nextTurn);                                 // 4. timeline
    }
    if (d.enviar || detectSend(text)) return cierreFlow(text, nextTurn);     // 5. envío
    if (d.setSeveridad || parseSeveridad(text)) {
      return severidadFlow(text, d, nextTurn);                              // 6. severidad
    }
    if (d.addServicios.length || d.correctServicio) return servicioFlow(text, d, nextTurn); // 7. servicios
    if (servicioNuevoEn(text)) return servicioFlow(text, d, nextTurn);
    if (!d.actionItems.length) {
      const items = extractActionItems(text);
      if (items.length) return actionItemFlow(items, nextTurn);             // 8. pendientes (reglas)
    }
    const cola = nItems
      ? `Va, anotado${nItems === 1 ? ' el pendiente' : `s los ${speakCount(nItems)} pendientes`}. ¿Algo más, o lo envío?`
      : 'Va, te escucho. ¿Qué más me cuentas para la ficha?';
    await speakChunks(cola, { interruptedBy: interruptOf(nextTurn) });      // 9. fallback
    return { interrupted: false };
  }

  /** Re-despacho tras una confirmación: el MISMO turno puede traer más
   *  (confirma la severidad y dicta pendientes, confirma la hora y agrega la
   *  siguiente…). Profundidad 1: sin recursión infinita. */
  async function afterConfirm(text, d, nextTurn) {
    return decide(text, d, nextTurn, 1);
  }

  /** ¿El texto/directivas traen algo más procesable tras confirmar? */
  function quedanPendientes(text, d) {
    if (horasNuevas(text).length) return true;
    if (detectSend(text)) return true;
    if (parseSeveridad(text)) return true;
    if (d.eventos.length || d.addServicios.length || d.correctServicio) return true;
    if (servicioNuevoEn(text)) return true;
    return false;
  }

  /* --------------------------- flows --------------------------- */

  async function incidenteFlow(text, d, nextTurn) {
    const r = await callTool('get_incidente', {
      incidente_id: d.getIncidente ?? guion.incidente_id ?? text.match(/IC-\d+/)?.[0] ?? '',
    });
    if (r.ok !== false && r.incidente) {
      incidente = r.incidente;
      st.incidenteCargado = true;
      await speakChunks(
        `Va, ya tengo el incidente ${incidente.id} de ${incidente.cliente}: ${incidente.reporte_inicial}. ` +
        'Cuéntame con calma qué pasó, tal cual lo viviste.',
        { interruptedBy: interruptOf(nextTurn) },
      );
    } else {
      await speakChunks('No encontré ese incidente. ¿Me repites el número? Es IC y cuatro dígitos.',
        { interruptedBy: interruptOf(nextTurn) });
    }
    return { interrupted: false };
  }

  async function quePasoFlow(text, d, nextTurn) {
    await callTool('set_que_paso', { texto: text });
    st.quePasoSet = true;
    /* narrativa con horas EN el dictado (guion mixto): registrarlas aquí
     * mismo y leerlas agrupadas — el operador no las repite. Espejo del
     * MODO NARRATIVO del prompt real (REGLA #1). */
    if (d.eventos.length) return eventoFlow(text, d, nextTurn);
    await speakChunks('Anotado tal cual lo dijiste. ¿A qué hora empezó todo? Dime la hora y qué pasó.',
      { interruptedBy: interruptOf(nextTurn) });
    return { interrupted: false };
  }

  /** Horas del texto que aún no están en el timeline (dedup por HH:MM). */
  function horasNuevas(text) {
    const out = [];
    const vistas = new Set();
    for (const { hora } of parseHoras(text)) {
      if (addedHoras.has(hora) || vistas.has(hora)) continue;
      vistas.add(hora);
      out.push(hora);
    }
    return out;
  }

  /**
   * Agrega los eventos (directiva exacta si la hay; si no, hora parseada +
   * cláusula del dictado) y lee en voz alta TODAS las horas nuevas del turno
   * (read-back de CADA hora, juntas cuando el dictado las trae juntas).
   */
  async function eventoFlow(text, d, nextTurn) {
    const clausulas = String(text).split(/(?:\.\.\.|[.,;])/);
    const nuevas = [];
    if (d.eventos.length) {
      for (const ev of d.eventos) {
        if (addedHoras.has(ev.hora)) continue;
        const r = await callTool('agregar_evento_timeline', { hora: ev.hora, evento: ev.evento });
        if (r.ok === false || r.error) continue;
        addedHoras.add(r.hora ?? ev.hora);
        nuevas.push(r.hora ?? ev.hora);
      }
    } else {
      for (const hora of horasNuevas(text)) {
        const evento = eventoDeClausula(hora, clausulas) || `Evento de las ${hora}`;
        const r = await callTool('agregar_evento_timeline', { hora, evento });
        if (r.ok === false || r.error) continue;
        addedHoras.add(hora);
        nuevas.push(hora);
      }
    }
    if (!nuevas.length) {
      await speakChunks('¿Alguna otra hora que te acuerdes? Dímela y la agrego al timeline.',
        { interruptedBy: interruptOf(nextTurn) });
      return { interrupted: false };
    }
    const lista = nuevas.map((h) => `a las ${speakHora(h)}`).join(' y ');
    await speakChunks(`Va. Te confirmo las horas: ${lista}, ¿correcto?`,
      { interruptedBy: interruptOf(nextTurn) });
    pendingConfirm = { kind: 'hora', horas: nuevas };
    return { interrupted: false };
  }

  /** Cláusula que menciona la hora (sin la expresión horaria), capitalizada. */
  function eventoDeClausula(hora, clausulas) {
    for (const c of clausulas) {
      const cl = String(c ?? '').trim();
      if (!cl || cl.length < 5) continue;
      if (parseHoras(cl).some((h) => h.hora === hora)) {
        return cl
          .replace(/\b(?:a|de|desde|hasta|sobre|como|casi|pasaban|pasaron|eran|era|serian)\s+(?:la|las)\s+(?:\d{1,2}:\d{2}|\d{1,2})(?:\s+(?:y|con)\s+\d{1,2})?\b/i, '')
          .replace(/\b\d{1,2}:\d{2}\b/, '')
          .replace(/^\s*(?:y|entonces|ya|pues|pos|mira|bueno|o sea)\s+/i, '')
          .replace(/\s+/g, ' ')
          .trim();
      }
    }
    return null;
  }

  /** ¿El texto trae un servicio NO agregado aún (regla, sin directiva)? */
  function servicioNuevoEn(text) {
    const scored = scoreServicios(text, servicios);
    const best = scored[0];
    return !!best && best.score >= 4 && !addedServicios.has(best.servicio.id);
  }

  async function servicioFlow(text, d, nextTurn) {
    await pause(150 + rng() * 60); // fin-de-habla → tool call (métrica de latencia)
    const r = await callTool('buscar_servicio', { consulta: d.buscar ?? text });
    let target = null;
    if (d.addServicios.length) {
      target = byId.get(d.addServicios[0]) ?? null;
    } else if (d.correctServicio) {
      target = byId.get(d.correctServicio) ?? null;
    } else if (r.best) {
      target = byId.get(r.best.id) ?? null;
    }
    if (!target) {
      await speakChunks('Ese servicio no lo encuentro en el catálogo. ¿Cómo le llaman en el ticket, exactamente?',
        { interruptedBy: interruptOf(nextTurn) });
      return { interrupted: false };
    }
    const added = await callTool('agregar_servicio_afectado', { id: target.id, afectados: parseAfectados(text) });
    if (!added || added.ok === false) {
      await speakChunks('No pude agregar ese servicio. Déjame reintentar con el id del catálogo.',
        { interruptedBy: interruptOf(nextTurn) });
      return { interrupted: false };
    }
    addedServicios.add(target.id);
    const captured = { id: target.id, nombre: target.nombre, afectados: added.afectados ?? null };
    const siblingId = d.addServicios.length
      ? target.confundible_con?.[0] ?? null
      : r.confusable_warning?.id ?? null;
    const sibling = siblingId ? byId.get(siblingId) : null;
    let speech;
    if (sibling && sibling.id !== target.id) {
      pendingConfirm = { kind: 'servicio-disambiguation', captured, sibling };
      speech = `Ojo, aquí se confunden fácil. ¿Decías ${speakServicioNombre(captured.nombre)}, ` +
        `o ${speakServicioNombre(sibling.nombre)}?`;
    } else {
      pendingConfirm = { kind: 'servicio-plain', captured, sibling: null };
      speech = `Anoto ${speakServicioNombre(captured.nombre)}${afectadosTxt(captured.afectados)}. ¿Correcto?`;
    }
    const res = await speakChunks(speech, { interruptedBy: interruptOf(nextTurn) });
    return { interrupted: res.interrupted };
  }

  async function severidadFlow(text, d, nextTurn) {
    const sev = d.setSeveridad ?? parseSeveridad(text);
    if (!sev) {
      await speakChunks('¿Qué severidad le ponemos: baja, media, alta o critica?',
        { interruptedBy: interruptOf(nextTurn) });
      return { interrupted: false };
    }
    await callTool('set_severidad', { severidad: sev });
    st.severidadSet = true;
    await speakChunks(`Anoto severidad ${sev.toUpperCase()}. ¿Correcto?`, // SIEMPRE read-back
      { interruptedBy: interruptOf(nextTurn) });
    pendingConfirm = { kind: 'severidad', severidad: sev };
    return { interrupted: false };
  }

  async function actionItemFlow(items, nextTurn) {
    for (const item of items) await callTool('agregar_action_item', { descripcion: item });
    await speakChunks(
      `Anotado${items.length === 1 ? ' el pendiente' : `s los ${speakCount(items.length)} pendientes`}. ¿Algo más?`,
      { interruptedBy: interruptOf(nextTurn) },
    );
    return { interrupted: false };
  }

  /* ---------------------- confirmaciones ----------------------- */

  async function confirmFlow(text, d, nextTurn, depth) {
    const pc = pendingConfirm;
    if (pc.kind === 'hora') return confirmHoraFlow(pc, text, d, nextTurn);
    if (pc.kind === 'severidad') return confirmSeveridadFlow(pc, text, d, nextTurn);
    /* servicio: con guion, la directiva correct_to manda (el operador puede
     * nombrar al hermano para EXCLUIRLO); sin guion, heurística del orden. */
    if (d.correctServicio && d.correctServicio !== pc.captured.id) {
      const nueva = byId.get(d.correctServicio);
      if (nueva) return servicioCorrectionFlow(pc, nueva, text, nextTurn);
    }
    if (pc.kind === 'servicio-disambiguation' && pc.sibling && !d.hasAgentTurn) {
      const conf = detectConfirm(text);
      const selA = mentionsAny(text, distinguishers(pc.captured, pc.sibling));
      const selB = mentionsAny(text, distinguishers(pc.sibling, pc.captured));
      const lastA = selA ? lastMention(text, selA) : -1;
      const lastB = selB ? lastMention(text, selB) : -1;
      if (lastB > lastA && lastB >= 0) return servicioCorrectionFlow(pc, pc.sibling, text, nextTurn);
      if (lastA >= 0 || (conf === 'yes' && lastB < 0)) return servicioOkFlow(pc, text, d, nextTurn);
      return reaskFlow(pc, nextTurn);
    }
    const conf = detectConfirm(text);
    if (conf === 'yes') return servicioOkFlow(pc, text, d, nextTurn);
    if (conf === 'no') {
      const r = await callTool('buscar_servicio', { consulta: text });
      const nueva = r.best && r.best.id !== pc.captured.id ? byId.get(r.best.id) : null;
      if (nueva) return servicioCorrectionFlow(pc, nueva, text, nextTurn);
      return reaskFlow(pc, nextTurn);
    }
    /* sin sí/no pero con más contenido en el turno: el operador da por
     * buena la captura y sigue dictando (p. ej. "ponle alta...") */
    if (quedanPendientes(text, d)) return servicioOkFlow(pc, text, d, nextTurn);
    return reaskFlow(pc, nextTurn);
  }

  async function confirmHoraFlow(pc, text, d, nextTurn) {
    const conf = detectConfirm(text);
    if (conf === 'no') {
      const nuevaHora = d.correctHora
        ?? parseHoras(text).map((h) => h.hora).find((h) => !pc.horas.includes(h))
        ?? null;
      if (nuevaHora && !pc.horas.includes(nuevaHora)) {
        emit('confirm_result', { field: 'hora', value: pc.horas[0], confirmed: false });
        await callTool('corregir_hora', { de: pc.horas[0], a: nuevaHora });
        addedHoras.delete(pc.horas[0]);
        addedHoras.add(nuevaHora);
        await speakChunks(`Corrijo: a las ${speakHora(nuevaHora)}, ¿ahora sí queda?`,
          { interruptedBy: interruptOf(nextTurn) });
        pendingConfirm = { kind: 'hora', horas: [nuevaHora] };
        return { interrupted: false };
      }
      await speakChunks('¿Entonces a qué hora fue? Dime la hora completa, por ejemplo diez cuarenta.',
        { interruptedBy: interruptOf(nextTurn) });
      pendingConfirm = { ...pc };
      return { interrupted: false };
    }
    if (conf === 'yes') {
      emit('confirm_result', { field: 'hora', value: horaValue(pc.horas), confirmed: true });
      pendingConfirm = null;
      if (quedanPendientes(text, d)) return afterConfirm(text, d, nextTurn);
      await speakChunks('Va, queda anotada. ¿Qué servicios o equipos se vieron afectados?',
        { interruptedBy: interruptOf(nextTurn) });
      return { interrupted: false };
    }
    /* sin sí/no: si el turno trae más contenido, la hora se da por aceptada
     * (dictado fluido) y seguimos; si no, re-preguntamos. */
    if (quedanPendientes(text, d)) {
      pendingConfirm = null;
      return afterConfirm(text, d, nextTurn);
    }
    await speakChunks(`¿Confirmo el evento a las ${speakHora(pc.horas[0])}?`,
      { interruptedBy: interruptOf(nextTurn) });
    pendingConfirm = { ...pc };
    return { interrupted: false };
  }

  async function confirmSeveridadFlow(pc, text, d, nextTurn) {
    const conf = detectConfirm(text);
    if (conf === 'no') {
      const nueva = d.setSeveridad ?? parseSeveridad(text);
      if (nueva && nueva !== pc.severidad) {
        emit('confirm_result', { field: 'severidad', value: pc.severidad, confirmed: false });
        await callTool('set_severidad', { severidad: nueva });
        const cola = d.actionItems.length
          ? ` Y anoté ${speakCount(d.actionItems.length)} pendiente${d.actionItems.length === 1 ? '' : 's'}.`
          : '';
        await speakChunks(`Corrijo: severidad ${nueva.toUpperCase()}, ¿ahora sí?${cola}`,
          { interruptedBy: interruptOf(nextTurn) });
        pendingConfirm = { kind: 'severidad', severidad: nueva };
        return { interrupted: false };
      }
      await speakChunks('¿Entonces qué severidad le ponemos: baja, media, alta o critica?',
        { interruptedBy: interruptOf(nextTurn) });
      pendingConfirm = { ...pc };
      return { interrupted: false };
    }
    if (conf === 'yes') {
      emit('confirm_result', { field: 'severidad', value: pc.severidad, confirmed: true });
      pendingConfirm = null;
      if (quedanPendientes(text, d)) return afterConfirm(text, d, nextTurn);
      await speakChunks(`Va, severidad ${pc.severidad}. ¿Queda algún pendiente o seguimiento?`,
        { interruptedBy: interruptOf(nextTurn) });
      return { interrupted: false };
    }
    await speakChunks(`¿Confirmo severidad ${pc.severidad.toUpperCase()}?`, { interruptedBy: interruptOf(nextTurn) });
    pendingConfirm = { ...pc };
    return { interrupted: false };
  }

  async function servicioOkFlow(pc, text, d, nextTurn) {
    emit('confirm_result', {
      field: 'servicio',
      value: { id: pc.captured.id, afectados: pc.captured.afectados },
      confirmed: true,
    });
    confirmedServicios.add(pc.captured.id);
    await callTool('confirmar_servicio', { id: pc.captured.id });
    pendingConfirm = null;
    if (d && quedanPendientes(text, d)) return afterConfirm(text, d, nextTurn);
    await speakChunks(
      `Queda confirmado: ${speakServicioNombre(pc.captured.nombre)}. ¿Qué otro servicio se vio afectado, o cómo seguimos?`,
      { interruptedBy: interruptOf(nextTurn) },
    );
    return { interrupted: false };
  }

  async function servicioCorrectionFlow(pc, nueva, text, nextTurn) {
    emit('confirm_result', {
      field: 'servicio',
      value: { id: pc.captured.id, afectados: pc.captured.afectados },
      confirmed: false,
    });
    await callTool('quitar_servicio', { id: pc.captured.id });
    addedServicios.delete(pc.captured.id);
    const afectados = parseAfectados(text) ?? pc.captured.afectados;
    await callTool('agregar_servicio_afectado', { id: nueva.id, afectados });
    addedServicios.add(nueva.id);
    pendingConfirm = {
      kind: 'servicio-plain',
      captured: { id: nueva.id, nombre: nueva.nombre, afectados },
      sibling: null,
    };
    await speakChunks(
      `Corrijo: ${speakServicioNombre(nueva.nombre)}${afectadosTxt(afectados)}. ¿Ahora sí confirmo?`,
      { interruptedBy: interruptOf(nextTurn) },
    );
    return { interrupted: false };
  }

  async function reaskFlow(pc, nextTurn) {
    const speech = pc.kind === 'servicio-disambiguation' && pc.sibling
      ? `No te entendí. ¿Es ${speakServicioNombre(pc.captured.nombre)} o ${speakServicioNombre(pc.sibling.nombre)}?`
      : pc.kind === 'hora'
        ? `¿Confirmo el evento a las ${speakHora(pc.horas[0])}?`
        : pc.kind === 'severidad'
          ? `¿Confirmo severidad ${pc.severidad.toUpperCase()}?`
          : `¿Confirmo ${speakServicioNombre(pc.captured.nombre)}${afectadosTxt(pc.captured.afectados)}?`;
    await speakChunks(speech, { interruptedBy: interruptOf(nextTurn) });
    pendingConfirm = { ...pc };
    return { interrupted: false };
  }

  /* --------------------------- cierre --------------------------- */

  async function cierreFlow(text, nextTurn) {
    if (!st.resumenSet) {
      const synth = synthResumen();
      if (synth) { await callTool('set_resumen', { texto: synth }); st.resumenSet = true; }
    }
    const r = await callTool('enviar_reporte', {});
    st.enviado = true;
    emit('report_sent', {}); // síncrono: sin drift de t_ms entre instant/realtime
    const rs = r?.resumen;
    await speakChunks(
      rs
        ? `Ficha de incidente enviada: ${rs.eventos} evento${rs.eventos === 1 ? '' : 's'}, ` +
          `${rs.servicios_confirmados} servicio${rs.servicios_confirmados === 1 ? '' : 's'} confirmado` +
          `${rs.servicios_confirmados === 1 ? '' : 's'}${rs.severidad ? `, severidad ${rs.severidad}` : ''}` +
          `${rs.action_items ? `, ${rs.action_items} pendiente${rs.action_items === 1 ? '' : 's'}` : ''}. ` +
          'Buen trabajo, descansa.'
        : 'Ficha de incidente enviada. Buen trabajo.',
      { interruptedBy: interruptOf(nextTurn) },
    );
    schedule(400, async () => doStop());
    return { interrupted: false };
  }

  /** Resumen de una línea cuando nadie lo dictó ni citó. */
  function synthResumen() {
    const partes = [];
    const nombres = [...confirmedServicios].map((id) => byId.get(id)?.nombre).filter(Boolean);
    if (nombres.length) partes.push(nombres.join(' y '));
    if (incidente?.reporte_inicial) partes.push(String(incidente.reporte_inicial).replace(/[.;]\s*$/, ''));
    if (!partes.length) return null;
    return partes.join(': ') + '.';
  }

  /* --------------------------- helpers --------------------------- */

  function interruptOf(nextTurn) {
    return nextTurn && nextTurn.interrupt ? nextTurn : null;
  }

  function lastMention(text, token) {
    const toks = normalizeText(text).split(' ');
    for (let i = toks.length - 1; i >= 0; i--) if (toks[i] === token) return i;
    return -1;
  }

  /** Tokens que distinguen un servicio de su confundible (espejo de piezas). */
  function distinguishers(a, b) {
    const setA = tokenSet([...(a.alias ?? []), a.nombre, a.id].join(' '));
    const setB = tokenSet([...(b?.alias ?? []), b?.nombre ?? '', b?.id ?? ''].join(' '));
    return new Set([...setA].filter((t) => !setB.has(t)));
  }

  /**
   * Confirmación hablada del dominio incidente, POR CLÁUSULAS: el operador
   * contesta el read-back en la PRIMERA cláusula ("Esa...", "Eso,
   * producción... y también...") y el resto del turno es dictado nuevo que
   * puede contener "no" gramaticales ("y no contestaba", "los pagos no
   * pasaban") que NO son respuestas. Un 'no' cuenta solo cuando ABRE una
   * cláusula ("no, era nueve cuarenta").
   */
  function detectConfirm(text) {
    const clauses = String(text ?? '')
      .split(/(?:\.\.\.|[.,;!?])/)
      .map((s) => s.trim())
      .filter(Boolean);
    const first = clauses[0] ?? String(text ?? '');
    const base = detectConfirmation(first);
    if (base) return base;
    const f = stripAccents(first).toLowerCase();
    if (/\b(esa|ese|eso|asi va|asi esta|asi queda|con eso|va)\b/.test(f)) return 'yes';
    for (const c of clauses) {
      if (/^\s*(no|negativo|espera|alto|cambio|incorrecto|equivocad\w*)\b/i.test(c)) return 'no';
    }
    return null;
  }

  /** "afectó a como 40 usuarios" → 40. null si no se dijo. */
  function parseAfectados(text) {
    const m = normalizeText(text).match(/(?:afecta\w*|impacta\w*|sin)\s+(?:a\s+)?(?:como\s+)?(\d{2,4})\s+(?:usuarios|empleados|personas|clientes|equipos|puestos)\b/);
    if (m) return Math.max(0, Math.round(+m[1]));
    return null;
  }

  function afectadosTxt(n) {
    return n != null ? `, ${n} afectados` : '';
  }

  function speakCount(n) {
    const words = ['cero', 'uno', 'dos', 'tres', 'cuatro', 'cinco', 'seis', 'siete', 'ocho', 'nueve', 'diez'];
    return n >= 0 && n <= 10 ? words[n] : String(n);
  }

  /** Pendientes dictados en el texto (regla, sin directiva). */
  function extractActionItems(text) {
    const out = [];
    const m = String(text ?? '').match(
      /(?:deja|dejar|anota|ap[uú]ntame|apuntale|me falt[oó]|faltan?)\s+(?:dos|tres|cuatro|\d+)?\s*pendientes?\s*:?\s+(.+)$/is,
    );
    if (m) {
      for (const parte of m[1].split(/,?\s*y\s+(?:que|el|la)\s+|;\s*/)) {
        const item = limpiarItem(parte);
        if (item) out.push(item);
      }
      return out;
    }
    const uno = extractActionItem(text);
    return uno ? [uno] : [];
  }

  function limpiarItem(s) {
    const t = String(s ?? '')
      .replace(/\s*[.,;]*(?:eso es todo|es todo|ya est[aá]|listo|m[aá]nda\w*)[\s\S]*$/i, '')
      .replace(/^que\s+(?:me|le|se|nos|te)?\s*/i, '')
      .replace(/[.,;]\s*$/, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (t.length < 4) return null;
    return t.charAt(0).toUpperCase() + t.slice(1);
  }

  async function playUserTurn(turn, nextTurn) {
    const heard = turn.as_heard ?? turn.text;
    lastUserN = turn.n ?? 0;
    await userSpeak(heard);
    const res = await respond(heard, nextTurn);
    return !!res?.consumedNext;
  }

  return api;
}

/* ------------------------------------------------------------------ */
/* PRNG determinista + hash de strings (mulberry32, igual que el orden) */
/* ------------------------------------------------------------------ */

function mulberry32(a) {
  let t = a >>> 0;
  return function next() {
    t |= 0; t = (t + 0x6D2B79F5) | 0;
    let x = Math.imul(t ^ (t >>> 15), 1 | t);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

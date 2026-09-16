#!/usr/bin/env node
/**
 * realgate.mjs — corre sesiones REALES del Voice Agent API (D2 GATE) desde Node.
 *
 * Sustituye el rig manual (altavoz+micrófono) por audio sintetizado controlado:
 * abre el WebSocket real (token temporal de un solo uso), construye session.update
 * con el prompt/turn-detection del proyecto y las tools con enum de catálogo,
 * transmite los WAV del guion (limpio o con ruido DEMAND a SNR fijo) a ritmo real
 * como si fuera el micrófono, ejecuta las tool calls contra el MISMO engine que el
 * browser (artefacto §6) y devuelve el artefacto para el harness de métricas.
 *
 * Dominios (--domain):
 *   orden    (default, back-compat): data/guiones, wavs en .data/tts[+ruido].
 *   incident (Plan B): data/guiones-incidente, wavs en .data/tts-incidente
 *            (dictado post-visita en AMBIENTE TRANQUILO, sin mezclas de ruido).
 *
 * Uso:
 *   node scripts/realgate.mjs --guion s1-happy-path [--noise DKITCHEN --snr 10]
 *        [--vad 0.4] [--idelay 0] [--tmode balanced] [--label T0] [--outdir .data/gate]
 *   node scripts/realgate.mjs --domain incident --guion i1-dictado-feliz
 *   node scripts/realgate.mjs --dry-run --guion s1-happy-path   # sin key: valida plomería
 *
 * Requiere ASSEMBLYAI_API_KEY en .env (jamás se imprime ni se envía al browser).
 * Coste: ~$4.50/h facturado por WS abierto — cada sesión del guion ≈ 2-4 min.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { buildSessionUpdate, buildToolResult, bytesToBase64 } = await import(
  new URL('../web/js/ws-agent.js', import.meta.url).href
);
const { createSessionEngine } = await import(new URL('../web/js/session-engine.js', import.meta.url).href);
const { realClock } = await import(new URL('../web/js/clock.js', import.meta.url).href);
const { AGENT_CONFIG } = await import(new URL('../web/js/agent-config.js', import.meta.url).href);

/* ---------------------------------- args ---------------------------------- */
function parseArgs(argv) {
  const a = { domain: 'orden', outdir: '.data/gate', vad: 0.4, idelay: 0, tmode: 'balanced', label: 'run' };
  for (let i = 2; i < argv.length; i++) {
    const k = argv[i];
    const next = () => argv[++i];
    if (k === '--domain') a.domain = String(next());
    else if (k === '--guion') a.guion = next();
    else if (k === '--noise') a.noise = next();
    else if (k === '--snr') a.snr = String(next());
    else if (k === '--vad') a.vad = Number(next());
    else if (k === '--idelay') a.idelay = Number(next());
    else if (k === '--tmode') a.tmode = String(next());
    else if (k === '--vfocus') a.vfocus = String(next());
    else if (k === '--label') a.label = String(next());
    else if (k === '--outdir') a.outdir = String(next());
    else if (k === '--dry-run') a.dryRun = true;
    else if (k === '--help' || k === '-h') a.help = true;
    else { console.error(`arg desconocido: ${k}`); process.exit(2); }
  }
  return a;
}
const args = parseArgs(process.argv);
if (args.help || !args.guion) {
  console.log('uso: node scripts/realgate.mjs [--domain orden|incident] --guion <id> [--noise DKITCHEN --snr 10] [--vad 0.4] [--idelay 0] [--tmode balanced] [--label T0] [--outdir .data/gate] [--dry-run]');
  process.exit(args.help ? 0 : 2);
}
if (!['orden', 'incident'].includes(args.domain)) {
  console.error(`--domain inválido: ${args.domain} (orden|incident)`);
  process.exit(2);
}
const INCIDENT = args.domain === 'incident';

/* -------- módulos del dominio (orden compartido | incidente Plan B) -------- */
let buildToolDefinitions;
let createToolRunner;
let createStore;
if (INCIDENT) {
  ({ buildIncidentToolDefinitions: buildToolDefinitions } = await import(
    new URL('../web/js/domain/incident/tools.js', import.meta.url).href
  ));
  ({ createIncidentToolRunner: createToolRunner } = await import(
    new URL('../web/js/domain/incident/tool-runner.js', import.meta.url).href
  ));
  ({ createIncidentStore: createStore } = await import(
    new URL('../web/js/domain/incident/store.js', import.meta.url).href
  ));
} else {
  ({ buildToolDefinitions } = await import(new URL('../web/js/tools.js', import.meta.url).href));
  ({ createToolRunner } = await import(new URL('../web/js/tool-runner.js', import.meta.url).href));
  ({ createStore } = await import(new URL('../web/js/store.js', import.meta.url).href));
}

/* ------------------------------- carga .env ------------------------------- */
function loadKey() {
  const p = join(ROOT, '.env');
  if (!existsSync(p)) return null;
  const m = /^ASSEMBLYAI_API_KEY=(.+)$/m.exec(readFileSync(p, 'utf8'));
  return m ? m[1].trim().replace(/^["']|["']$/g, '') : null;
}

/* --------------------------------- datos ---------------------------------- */
const guionDir = INCIDENT ? 'guiones-incidente' : 'guiones';
const gtDir = INCIDENT ? 'ground-truth-incidente' : 'ground-truth';
const guion = JSON.parse(readFileSync(join(ROOT, 'data', guionDir, `${args.guion}.json`), 'utf8'));
const userTurns = guion.turns.filter((t) => t.role === 'user');

/* catálogo + caso activo del dominio */
let casos;
let catalogo;
let casoId;
if (INCIDENT) {
  casos = JSON.parse(readFileSync(join(ROOT, 'data/incidentes.json'), 'utf8'));
  catalogo = JSON.parse(readFileSync(join(ROOT, 'data/servicios.json'), 'utf8'));
  casoId = guion.incidente_id;
} else {
  casos = JSON.parse(readFileSync(join(ROOT, 'data/ordenes.json'), 'utf8'));
  catalogo = JSON.parse(readFileSync(join(ROOT, 'data/piezas.json'), 'utf8'));
  casoId = guion.order_id;
}
const caso = casos.find((c) => c.id === casoId);

/* wavs: incidente SIEMPRE de .data/tts-incidente (ambiente tranquilo, sin
 * mezclas de ruido); orden igual que siempre (tts limpio o noisy a SNR). */
const noiseDir = !INCIDENT && args.noise && args.snr && args.snr !== 'clean'
  ? join('.data', 'noisy', args.guion, args.noise, `${args.snr}db`)
  : join(INCIDENT ? '.data/tts-incidente' : '.data/tts', args.guion);
const wavPath = (n, variant = '') => join(ROOT, noiseDir, `turn-${String(n).padStart(2, '0')}${variant}.wav`);
for (const t of userTurns) {
  if (!existsSync(wavPath(t.n))) { console.error(`FALTA wav del turno ${t.n}: ${wavPath(t.n)}`); process.exit(1); }
  if (t.as_heard && !existsSync(wavPath(t.n, '-as-heard'))) {
    console.warn(`  ⚠ turno ${t.n} tiene as_heard sin wav (${wavPath(t.n, '-as-heard')}) — el gate reproduce el audio limpio`);
  }
}
if (!args.dryRun && !existsSync(join(ROOT, '.data/noise'))) {
  /* no bloquea: ruido es opcional para clean */
}

/* WAV RIFF → Int16Array (mono 24k pcm16, el formato de nuestros scripts) */
function readWavPcm16(path) {
  const b = readFileSync(path);
  if (b.toString('ascii', 0, 4) !== 'RIFF' || b.toString('ascii', 8, 12) !== 'WAVE') throw new Error(`no RIFF/WAVE: ${path}`);
  let off = 12, data = null;
  while (off + 8 <= b.length) {
    const id = b.toString('ascii', off, off + 4);
    const len = b.readUInt32LE(off + 4);
    if (id === 'data') { data = b.subarray(off + 8, off + 8 + len); break; }
    off += 8 + len + (len % 2);
  }
  if (!data) throw new Error(`sin chunk data: ${path}`);
  const i16 = new Int16Array(data.buffer, data.byteOffset, Math.floor(data.byteLength / 2));
  return i16;
}

/* --------------------------- config de sesión ----------------------------- */
const turnDetection = {
  vad_threshold: args.vad,
  interrupt_response: true,
  interruption_delay: args.idelay,
};
const inputCfg = args.vfocus ? { ...AGENT_CONFIG.input, voice_focus: args.vfocus, voice_focus_threshold: 0.5 } : AGENT_CONFIG.input;

let systemPrompt;
let greeting;
let tools;
if (INCIDENT) {
  systemPrompt = `${AGENT_CONFIG.system_prompt}

PERO HOY ERES EL REGISTRADOR DE INCIDENTES (post-visita). El operador YA terminó
su visita y te DICTA lo que pasó desde un lugar tranquilo (camioneta, oficina
vacía): habla pausado, en flujo continuo, y a veces suelta VARIOS datos en un
mismo turno (dos horas, un servicio y un pendiente...). El incidente activo YA
está asignado por la app: ${casoId} — cliente ${caso?.cliente ?? '?'}, reporte inicial: ${caso?.reporte_inicial ?? '?'}. Llama get_incidente SIN argumentos al inicio. NUNCA preguntes el número.

REGLA #1 — NINGÚN dato dicho se queda sin tool call. El operador dicta una sola
vez y NO repite: la hora, servicio, severidad o pendiente que no registras en
ese turno SE PIERDE. Pedir más detalle antes de registrar ("¿y qué pasó
exactamente a esa hora?") cuando ya te dio hora Y hecho es un FALLO: registra y
confirma. Solo pregunta lo que de VERDAD no te dio.

MODO NARRATIVO — turno con varios datos: UNA tool call POR DATO (varias
seguidas, mismo turno) y cierra con UN read-back agrupado: "a las ocho cincuenta
la llamada, a las nueve y cuarto el diagnóstico, ¿correcto?". Si el operador
dice "apúntale/anota/registra eso", ES tool call INMEDIATO — nunca lo vuelvas a
preguntar.

FLUJO — fases de la FICHA (el operador puede saltarlas o mezclarlas; tú registras):
1. get_incidente() y confirma en UNA frase de qué va el incidente.
2. El operador narra → set_que_paso con su texto LITERAL (sin parafrasear). Si
   la narrativa ya trae horas con su hecho, régstralas ahí mismo (regla #1);
   si van sueltas, pídelas en orden después ("¿a qué hora empezó todo?").
3. Cada hora dicha → agregar_evento_timeline({"hora":"H:MM","evento":"..."}) y
   READ-BACK de la(s) hora(s) en voz alta. Si corrige ("no, eran las nueve
   cuarenta"), corrígela y re-confirma.
4. Cada servicio/equipo mencionado → buscar_servicio({"consulta":"<tal cual>"})
   INMEDIATAMENTE. Con confusable_warning, DESAMBIGÚA nombrando AMBOS: "¿el
   servidor web de producción o el de staging?". Sin warning: agregar_servicio_
   afectado(id) EN EL MISMO turno antes de hablar + read-back del nombre.
5. Severidad → set_severidad SOLO con la que declaró, y SIEMPRE read-back:
   "anoto severidad alta, ¿correcto?".
6. Pendientes ("hay que...", "queda pendiente...", "que me compren...") →
   agregar_action_item, uno por llamada. Al final arma set_resumen de UNA línea.
7. El operador pida enviar ("mándalo", "listo") → enviar_reporte() y despídete.
CONFIRMACIONES: con su "sí/correcto/ese mismo" el dato YA queda — no lo re-agregues.
Respeta el campo siguiente_paso de los resultados de las tools.
HORAS: dichas con palabras se escriben "H:MM" en la tool: "ocho cincuenta"→"8:50",
"nueve veinte"→"9:20", "once y cuarto"→"11:15", "nueve cuarenta"→"9:40".
EJEMPLO: usuario: "la llamada fue como a las ocho cincuenta de la mañana" → tú llamas
agregar_evento_timeline({"hora":"8:50","evento":"llamada de recepción por falta de internet"}) → dices:
"Evento a las ocho cincuenta, llamada de recepción, ¿correcto?" → usuario: "sí" →
tú: "Anotado" y SIGUES (sin re-agregar). Turno con DOS horas ("a las diez diez lo
cambié y a las diez veinte ya estaba todo arriba") → DOS agregar_evento_timeline
en ese turno + un read-back agrupado de ambas.
NUNCA respondas en silencio: cada turno tuyo lleva al menos una frase corta (el
read-back, o "anotado, sigue con lo demás").
Regla de oro: cada dato que te den ES un tool call; tu única libertad es el read-back.`;
  greeting = `¡Buen día! Ya cargué el incidente ${casoId} de ${caso?.cliente ?? 'tu cliente'}. Cuéntame con calma qué pasó, con horas y todo, y voy anotando cada cosa en el momento.`;
  tools = buildToolDefinitions(catalogo.map((s) => s.id));
} else {
  const order = casos.find((o) => o.id === guion.order_id);
  systemPrompt = `${AGENT_CONFIG.system_prompt}

CONTEXTO DE SESIÓN: la orden activa YA está asignada por la app: ${guion.order_id} — cliente ${order?.cliente ?? '?'}, equipo: ${order?.equipo ?? '?'}. Llama get_orden SIN argumentos al inicio para cargarla. NUNCA preguntes el número de orden: ya lo tienes.

FLUJO OBLIGATORIO — una cosa por turno, sin excepciones:
1. Inicio: get_orden() y confirma en UNA frase de qué va la orden.
2. El usuario describa el síntoma → set_problema con su texto LITERAL (sin parafrasear).
3. Cada VEZ que el usuario MENCIONE una pieza —aunque sea de pasada o a medias—:
   buscar_pieza({"consulta": "<lo que dijo, tal cual>"}) INMEDIATAMENTE. NUNCA pidas
   "el nombre" de una pieza que ya te dijo: BÚSCALA tú. Si el resultado trae
   confusable_warning, pregunta la desambiguación nombrando ambos candidatos.
   Si no trae warning: agregar_pieza_a_reporte(sku, qty) y el read-back en voz alta
   ("X, N piezas, ¿correcto?"). Con su "sí" la pieza queda confirmada.
4. El usuario diga la solución → set_solucion. El usuario diga el tiempo ("como
   cincuenta minutos") → get_tiempo_trabajo({"minutos": 50}) con el NÚMERO que
   declaró. NUNCA inventes ni adivines tiempos.
5. El usuario pida enviar ("mándalo", "listo", "eso es todo") → enviar_reporte()
   INMEDIATAMENTE, sin pedir nada más, y despídete en una frase.
CONFIRMACIONES: cuando el usuario responda "sí/correcto/ese mismo" a tu read-back,
la pieza YA ESTÁ registrada — NO la vuelvas a agregar, solo agradece y continúa.
EJEMPLO: usuario: "el capacitor de cuarenta y cinco más cinco se hinchó" → tú llamas
buscar_pieza({"consulta":"capacitor de cuarenta y cinco más cinco"}) → (llega sku
CAP-ARR-455) → agregar_pieza_a_reporte({"sku":"CAP-ARR-455","qty":1}) → dices:
"Capacitor de arranque cuarenta y cinco más cinco, UNA pieza, ¿correcto?" →
usuario: "correcto, una pieza" → tú: "Anotado" y SIGUES (sin re-agregar).
Regla de oro: cada dato que te den ES un tool call; tu única libertad es el read-back.`;
  greeting = `¡Buen día! Ya cargué la orden ${guion.order_id} de ${order?.cliente ?? 'tu cliente'}. Narrame lo que vas haciendo y voy llenando la ficha mientras trabajas.`;
  tools = buildToolDefinitions(catalogo.map((p) => p.sku));
}
const sessionUpdate = buildSessionUpdate(
  { ...AGENT_CONFIG, system_prompt: systemPrompt, greeting, turn_detection: turnDetection, input: { ...inputCfg, transcription_mode: args.tmode } },
  tools,
);
if (args.dryRun) {
  console.log('[dry-run] session.update OK — claves:', Object.keys(sessionUpdate).join(','), '| session:', Object.keys(sessionUpdate.session ?? {}).join(','));
  console.log('[dry-run] domain:', args.domain, '| tools:', tools.length, '| turn_detection:', JSON.stringify(turnDetection), '| tmode:', args.tmode);
  console.log('[dry-run] wavs verificados:', userTurns.length, 'en', noiseDir);
  console.log('[dry-run] PLomería OK — falta solo la key para una sesión real.');
  process.exit(0);
}

/* ---------------------------------- key ----------------------------------- */
const key = loadKey();
if (!key) { console.error('ASSEMBLYAI_API_KEY ausente en .env — ver .env.example'); process.exit(1); }

/* ------------------------------- token temporal ---------------------------- */
async function tempToken() {
  const r = await fetch('https://agents.assemblyai.com/v1/token?expires_in_seconds=180', {
    headers: { Authorization: `Bearer ${key}` },
  });
  if (!r.ok) throw new Error(`token endpoint ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return (await r.json()).token;
}

/* ------------------------------- sesión engine ----------------------------- */
const noiseCondition = INCIDENT
  ? (args.noise && args.snr && args.snr !== 'clean' ? `demand_${args.noise.toLowerCase()}_${args.snr}db` : 'tranquilo')
  : (args.noise && args.snr !== 'clean' ? `demand_${args.noise.toLowerCase()}_${args.snr}db` : 'clean');
const sessionId = `gate_${args.label}_${Date.now().toString(36)}`;
const store = INCIDENT
  ? createStore({ incidenteId: casoId })
  : createStore({ orderId: guion.order_id });
const toolRunner = INCIDENT
  ? createToolRunner({ incidentes: casos, servicios: catalogo, store, clock: realClock() })
  : createToolRunner({ ordenes: casos, piezas: catalogo, store, clock: realClock() });
const pendingToolResults = [];   // {callId, msg} — drenar en reply.done(completed)
let lastAgentPartial = '';
const channel = {
  handlers: {},
  on(type, fn) { this.handlers[type] = fn; },
  emit(type, data) { this.handlers[type]?.(data); },
  send(type, data) {
    if (type === 'tool_result' && data?.call_id) {
      pendingToolResults.push({ callId: data.call_id, msg: buildToolResult(data.call_id, data.result, !data.ok) });
    }
  },
};
const engine = createSessionEngine({
  channel,
  toolRunner,
  store,
  meta: { session_id: sessionId, scenario_id: args.guion, mode: 'real', order_id: INCIDENT ? casoId : guion.order_id, noise_condition: noiseCondition },
  clock: realClock(),
});

/* ------------------------------ bucle de audio ----------------------------- */
const FRAME_MS = 100;
const RATE = 24000;
const FRAME_SAMPLES = (RATE * FRAME_MS) / 1000;
const SILENCE = new Int16Array(FRAME_SAMPLES);

let ws = null;
let audioPos = 0;
let currentPcm = null;         // Int16Array del turno en curso
let speechStartedAt = null;    // para latencia de barge-in
let agentReplyActive = false;
let stopPump = false;

function sendFrame() {
  if (stopPump || ws?.readyState !== 1) return;
  let frame;
  if (currentPcm && audioPos < currentPcm.length) {
    frame = currentPcm.subarray(audioPos, audioPos + FRAME_SAMPLES);
    audioPos += FRAME_SAMPLES;
    if (audioPos >= currentPcm.length) currentPcm = null; // sigue silencio hasta que el VAD cierre el turno
  } else {
    frame = SILENCE;
  }
  ws.send(JSON.stringify({ type: 'input.audio', audio: bytesToBase64(new Uint8Array(frame.buffer, frame.byteOffset, frame.byteLength)) }));
}

/* pacing en tiempo real con corrección de deriva (audio_rate_violation si nos pasamos).
 * La base se REINICIA cuando empieza el streaming real (tras session.ready). */
let t0 = performance.now();
let sentFrames = 0;
function resetPacing() { t0 = performance.now(); sentFrames = 0; }
const pump = setInterval(() => {
  const due = Math.floor((performance.now() - t0) / FRAME_MS);
  while (sentFrames < due) { sendFrame(); sentFrames++; }
}, 25);

/* ----------------------------- events del server --------------------------- */
function onServerMessage(msg) {
  switch (msg.type) {
    case 'session.ready':
      console.log(`  sesión ${msg.session_id} lista`);
      break;
    case 'input.speech.started':
      engine.handleEvent('user_turn_start', {});
      break;
    case 'transcript.user.delta':
      engine.handleEvent('user_turn_delta', { text: msg.text });
      break;
    case 'transcript.user':
      engine.handleEvent('user_turn_end', { text: msg.text });
      driver.onUserTurnEnd?.(msg.text);
      break;
    case 'reply.started':
      agentReplyActive = true;
      engine.handleEvent('agent_turn_start', {});
      driver.onReplyStarted?.();
      break;
    case 'transcript.agent.delta':
      lastAgentPartial += (msg.delta ?? '') + ' ';
      engine.handleEvent('agent_turn_text', { text: (msg.delta ?? '') + ' ' });
      break;
    case 'reply.done': {
      const interrupted = msg.status === 'interrupted';
      engine.handleEvent('agent_turn_end', { interrupted });
      agentReplyActive = false;
      if (interrupted) {
        pendingToolResults.length = 0; // protocolo: descartar pendientes al interrumpir
        const latency = speechStartedAt != null ? Math.round(performance.now() - speechStartedAt) : null;
        engine.handleEvent('barge_in', { agent_text_cut: lastAgentPartial, user_text: '', latency_ms: latency });
        speechStartedAt = null;
      } else {
        for (const p of pendingToolResults.splice(0)) ws.send(JSON.stringify(p.msg));
      }
      lastAgentPartial = '';
      driver.onReplyDone?.(interrupted);
      break;
    }
    case 'tool.call':
      engine.handleEvent('tool_call', { call_id: msg.call_id, tool: msg.name, args: msg.arguments });
      break;
    case 'session.ended':
      console.log(`  session.ended dur=${msg.session_duration_seconds}s audio=${msg.audio_duration_seconds}s`);
      driver.onEnded?.();
      break;
    case 'session.error':
      console.error(`  session.error ${msg.code}: ${msg.message}`);
      driver.onEnded?.(msg.code);
      break;
    default:
      break;
  }
}

/* --------------------- orquestación de turnos del guion -------------------- */
const driver = { onReplyStarted: null, onReplyDone: null, onUserTurnEnd: null, onEnded: null };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function playTurn(t) {
  if (t.interrupt) {
    // BARGE-IN: esperar a que el agente EMPIECE su reply y hablarle encima
    const started = performance.now();
    while (!agentReplyActive && performance.now() - started < 12000) await sleep(80);
    if (!agentReplyActive) console.log(`  ⚠ turno ${t.n}: el agente no abrió reply — reproduciendo igual`);
  } else {
    // Ceder el turno COMPLETO al agente: esperar reply.started (≤8 s) y reply.done (≤30 s)
    const t0w = performance.now();
    while (!agentReplyActive && performance.now() - t0w < 8000) await sleep(80);
    while (agentReplyActive && performance.now() - t0w < 30000) await sleep(80);
  }
  await sleep(t.interrupt ? 150 : 400); // respiración (mínima si interrumpimos)
  currentPcm = readWavPcm16(wavPath(t.n));
  audioPos = 0;
  if (t.interrupt) speechStartedAt = performance.now();
  console.log(`  ▶ turno ${t.n}${t.interrupt ? ' [INTERRUPT]' : ''} (${(currentPcm.length / RATE).toFixed(1)}s)`);
  // esperar a que el server cierre el turno (transcript.user) — máx 10 s tras el audio
  return new Promise((resolve) => {
    const timeout = setTimeout(() => { driver.onUserTurnEnd = null; resolve('timeout'); }, (currentPcm.length / RATE) * 1000 + 10000);
    driver.onUserTurnEnd = () => { clearTimeout(timeout); driver.onUserTurnEnd = null; resolve('ok'); };
  });
}

async function run() {
  console.log(`[realgate] ${args.label} · ${args.domain}:${args.guion} · ${noiseCondition} · vad=${args.vad} idelay=${args.idelay} tmode=${args.tmode}`);
  const token = await tempToken();
  console.log('  token temporal OK (un solo uso, 180 s)');
  ws = new WebSocket(`wss://agents.assemblyai.com/v1/ws?token=${encodeURIComponent(token)}`);
  const watchdog = setTimeout(() => { console.error('  WATCHDOG 300s — cerrando'); finish('watchdog'); }, 300000);

  const opened = new Promise((res, rej) => {
    ws.addEventListener('open', () => res());
    ws.addEventListener('error', (e) => rej(new Error(`ws error: ${e.message ?? e.type}`)));
    ws.addEventListener('close', (e) => { if (e.code !== 1000) console.error(`  ws close ${e.code}`); });
  });
  await opened;
  ws.addEventListener('close', (e) => { if (!finished && e.code !== 1000) finish(`ws-close-${e.code}`); });
  ws.addEventListener('message', (ev) => onServerMessage(JSON.parse(ev.data)));
  ws.send(JSON.stringify(sessionUpdate));
  await sleep(600); // session.ready
  resetPacing();

  let turnIdx = 0;
  for (;;) {
    const t = userTurns[turnIdx];
    if (!t) break;
    await playTurn(t);
    turnIdx++;
  }
  // cierre: último reply + tools drenadas
  const deadline = performance.now() + 30000;
  while ((agentReplyActive || pendingToolResults.length) && performance.now() < deadline) await sleep(200);
  await sleep(800);
  finish('completed');
  clearTimeout(watchdog);
}

let finished = false;

/**
 * En modo real el loop de confirmación vive en el DIÁLOGO (el agente pregunta
 * "¿correcto?" y el técnico responde), no en eventos del server. Derivamos
 * confirm_request/confirm_result del transcript y los inyectamos como eventos
 * marcados derived:'transcript' — el artefacto queda como fuente única y el
 * harness de métricas puede medir el loop sin cambios.
 */
function deriveConfirmations(artifact) {
  const tr = artifact.transcript;
  const norm = (s) => (s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  if (INCIDENT) {
    const servicios = artifact.final_form.servicios_afectados ?? [];
    for (let i = 0; i < tr.length; i++) {
      const t = tr[i];
      if (t.role !== 'agent') continue;
      const a = norm(t.text);
      const isReadback = /(correcto|confirmo|va bien|ahora si|cierto)\s*\??\s*$/.test(a.trim()) && a.length > 15;
      if (!isReadback) continue;
      const next = tr.slice(i + 1).find((x) => x.role === 'user');
      if (!next) continue;
      const u = norm(next.text);
      const yes = /(^|\s)(si|correcto|ese mismo|esa misma|asi es|esa|ese|eso|va|ok|est bien)(\s|,|!|$)/.test(u.slice(0, 60));
      const corr = /(no,? no|era la|era el|no es|no, es|cambiala|cambiela)/.test(u.slice(0, 60));
      let field = 'servicio';
      let value = null;
      if (/severidad/.test(a)) {
        field = 'severidad';
        value = artifact.final_form.severidad ?? null;
      } else if (/a las|hora/.test(a)) {
        field = 'hora';
        const horas = (artifact.final_form.timeline ?? []).map((e) => e.hora);
        value = horas.length ? horas[horas.length - 1] : null;
      } else {
        const target = servicios.find((s) => !s.confirmado)
          ?? servicios[servicios.length - 1] ?? null;
        value = target ? { id: target.id } : null;
      }
      artifact.events.push({ t_ms: t.t_end_ms ?? t.t_start_ms ?? 0, type: 'confirm_request', field, value, derived: 'transcript' });
      artifact.events.push({ t_ms: next.t_end_ms ?? next.t_start_ms ?? 0, type: 'confirm_result', field, value, confirmed: yes && !corr, derived: 'transcript' });
      if (field === 'servicio' && value?.id && yes && !corr) {
        const s = servicios.find((x) => x.id === value.id);
        if (s) s.confirmado = true;
      }
    }
    artifact.events.sort((x, y) => x.t_ms - y.t_ms);
    return;
  }
  const pieces = artifact.final_form.piezas ?? [];
  const keyword = (p) => norm(p.nombre).split(/\s+/).find((w) => w.length > 4 && !['laton', 'neopreno', 'reforzada', 'arranque', 'trabajo'].includes(w)) ?? norm(p.sku);
  for (let i = 0; i < tr.length; i++) {
    const t = tr[i];
    if (t.role !== 'agent') continue;
    const a = norm(t.text);
    const isReadback = /(correcto|confirmo|va bien|ahora si)\s*\??\s*$/.test(a.trim()) && a.length > 15;
    if (!isReadback) continue;
    const next = tr.slice(i + 1).find((x) => x.role === 'user');
    if (!next) continue;
    const u = norm(next.text);
    const yes = /(^|\s)(si|correcto|ese mismo|esa misma|asi es|va|ok|est bien)(\s|,|!|$)/.test(u.slice(0, 60));
    const corr = /(no,? no|era la|era el|no es|cambiala|cambiela)/.test(u.slice(0, 60));
    const target = pieces.find((p) => a.includes(keyword(p)?.slice(0, 6)))
      ?? (pieces.filter((p) => !p.confirmada)[0] ?? null);
    artifact.events.push({ t_ms: t.t_end_ms ?? t.t_start_ms ?? 0, type: 'confirm_request', field: 'pieza', value: target ? { sku: target.sku, qty: target.qty } : null, derived: 'transcript' });
    artifact.events.push({ t_ms: next.t_end_ms ?? next.t_start_ms ?? 0, type: 'confirm_result', field: 'pieza', value: target ? { sku: target.sku, qty: target.qty } : null, confirmed: yes && !corr, derived: 'transcript' });
    if (target && yes && !corr) target.confirmada = true;
  }
  artifact.events.sort((x, y) => x.t_ms - y.t_ms);
}
function finish(reason) {
  if (finished) return;
  finished = true;
  stopPump = true;
  clearInterval(pump);
  try { ws?.readyState === 1 && ws.send(JSON.stringify({ type: 'session.end' })); } catch {}
  setTimeout(() => { try { ws?.close(); } catch {} }, 1500).unref?.();
  const artifact = engine.end();
  artifact.turn_detection = { ...turnDetection, transcription_mode: args.tmode, voice_focus: args.vfocus ?? null, label: args.label, reason };
  deriveConfirmations(artifact);
  const dir = join(ROOT, args.outdir);
  mkdirSync(dir, { recursive: true });
  const out = join(dir, `artifact-${args.guion}-${noiseCondition}-${args.label}.json`);
  writeFileSync(out, JSON.stringify(artifact, null, 2));
  const evs = artifact.events;
  const count = (ty) => evs.filter((e) => e.type === ty).length;
  console.log(`\n[realgate:${reason}] ${out}`);
  console.log(`  turnos user=${count('user_turn_end')} agent=${count('agent_turn_end')} tools=${count('tool_call')} confirm=${count('confirm_result')} barge_in=${count('barge_in')} errores=${count('session_error')}`);
  if (INCIDENT) {
    const f = artifact.final_form;
    console.log(`  ficha: ${(f.servicios_afectados ?? []).map((s) => `${s.id}${s.confirmado ? '✓' : '?'}`).join(' · ') || '(sin servicios)'} · timeline=${(f.timeline ?? []).length} ev · sev=${f.severidad ?? '?'} · items=${(f.action_items ?? []).length} · estado=${f.estado}`);
  } else {
    console.log(`  ficha: ${artifact.final_form.piezas.map((p) => `${p.sku}x${p.qty}${p.confirmada ? '✓' : '?'}`).join(' · ') || '(sin piezas)'} · tiempo=${artifact.final_form.tiempo_minutos ?? '?'}min · estado=${artifact.final_form.estado}`);
  }
  console.log(`  métricas: node metrics/cli.js ${JSON.stringify(out)} --gt data/${gtDir}/gt-${args.guion}.json`);
  setTimeout(() => process.exit(0), 1800).unref?.();
}

process.on('SIGINT', () => finish('sigint'));
run().catch((e) => { console.error(`FALLO: ${e.message}`); finish('error'); });

#!/usr/bin/env node
/**
 * realgate.mjs — corre sesiones REALES del Voice Agent API (D2 GATE) desde Node.
 *
 * Sustituye el rig manual (altavoz+micrófono) por audio sintetizado controlado:
 * abre el WebSocket real (token temporal de un solo uso), construye session.update
 * con el prompt/turn-detection del proyecto y las 7 tools con enum de catálogo,
 * transmite los WAV del guion (limpio o con ruido DEMAND a SNR fijo) a ritmo real
 * como si fuera el micrófono, ejecuta las tool calls contra el MISMO engine que el
 * browser (artefacto §6) y devuelve el artefacto para el harness de métricas.
 *
 * Uso:
 *   node scripts/realgate.mjs --guion s1-happy-path [--noise DKITCHEN --snr 10]
 *        [--vad 0.4] [--idelay 0] [--tmode balanced] [--label T0] [--outdir .data/gate]
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
const { buildToolDefinitions } = await import(new URL('../web/js/tools.js', import.meta.url).href);
const { createToolRunner } = await import(new URL('../web/js/tool-runner.js', import.meta.url).href);
const { createStore } = await import(new URL('../web/js/store.js', import.meta.url).href);
const { createSessionEngine } = await import(new URL('../web/js/session-engine.js', import.meta.url).href);
const { realClock } = await import(new URL('../web/js/clock.js', import.meta.url).href);
const { AGENT_CONFIG } = await import(new URL('../web/js/agent-config.js', import.meta.url).href);

/* ---------------------------------- args ---------------------------------- */
function parseArgs(argv) {
  const a = { outdir: '.data/gate', vad: 0.4, idelay: 0, tmode: 'balanced', label: 'run' };
  for (let i = 2; i < argv.length; i++) {
    const k = argv[i];
    const next = () => argv[++i];
    if (k === '--guion') a.guion = next();
    else if (k === '--noise') a.noise = next();
    else if (k === '--snr') a.snr = String(next());
    else if (k === '--vad') a.vad = Number(next());
    else if (k === '--idelay') a.idelay = Number(next());
    else if (k === '--tmode') a.tmode = String(next());
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
  console.log('uso: node scripts/realgate.mjs --guion s1-happy-path [--noise DKITCHEN --snr 10] [--vad 0.4] [--idelay 0] [--tmode balanced] [--label T0] [--outdir .data/gate] [--dry-run]');
  process.exit(args.help ? 0 : 2);
}

/* ------------------------------- carga .env ------------------------------- */
function loadKey() {
  const p = join(ROOT, '.env');
  if (!existsSync(p)) return null;
  const m = /^ASSEMBLYAI_API_KEY=(.+)$/m.exec(readFileSync(p, 'utf8'));
  return m ? m[1].trim().replace(/^["']|["']$/g, '') : null;
}

/* --------------------------------- datos ---------------------------------- */
const ordenes = JSON.parse(readFileSync(join(ROOT, 'data/ordenes.json'), 'utf8'));
const piezas = JSON.parse(readFileSync(join(ROOT, 'data/piezas.json'), 'utf8'));
const guion = JSON.parse(readFileSync(join(ROOT, 'data/guiones', `${args.guion}.json`), 'utf8'));
const userTurns = guion.turns.filter((t) => t.role === 'user');

const noiseDir = args.noise && args.snr && args.snr !== 'clean'
  ? join('.data', 'noisy', args.guion, args.noise, `${args.snr}db`)
  : join('.data', 'tts', args.guion);
const wavPath = (n, variant = '') => join(ROOT, noiseDir, `turn-${String(n).padStart(2, '0')}${variant}.wav`);
for (const t of userTurns) {
  if (!existsSync(wavPath(t.n))) { console.error(`FALTA wav del turno ${t.n}: ${wavPath(t.n)}`); process.exit(1); }
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
const catalogSkus = piezas.map((p) => p.sku);
const tools = buildToolDefinitions(catalogSkus);
const sessionUpdate = buildSessionUpdate(
  { ...AGENT_CONFIG, turn_detection: turnDetection, input: { ...AGENT_CONFIG.input, transcription_mode: args.tmode } },
  tools,
);
if (args.dryRun) {
  console.log('[dry-run] session.update OK — claves:', Object.keys(sessionUpdate).join(','), '| session:', Object.keys(sessionUpdate.session ?? {}).join(','));
  console.log('[dry-run] tools:', tools.length, '| turn_detection:', JSON.stringify(turnDetection), '| tmode:', args.tmode);
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
const order = ordenes.find((o) => o.id === guion.order_id);
const noiseCondition = args.noise && args.snr !== 'clean' ? `demand_${args.noise.toLowerCase()}_${args.snr}db` : 'clean';
const sessionId = `gate_${args.label}_${Date.now().toString(36)}`;
const store = createStore({ orderId: guion.order_id });
const toolRunner = createToolRunner({ ordenes, piezas, store, clock: realClock() });
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
  meta: { session_id: sessionId, scenario_id: args.guion, mode: 'real', order_id: guion.order_id, noise_condition: noiseCondition },
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
      lastAgentPartial += msg.delta ?? '';
      engine.handleEvent('agent_turn_text', { text: msg.delta ?? '' });
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
    // esperar a que el agente termine su reply anterior (o timeout de seguridad)
    const deadline = performance.now() + 30000;
    while (agentReplyActive && performance.now() < deadline) await sleep(100);
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
  console.log(`[realgate] ${args.label} · ${args.guion} · ${noiseCondition} · vad=${args.vad} idelay=${args.idelay} tmode=${args.tmode}`);
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
function finish(reason) {
  if (finished) return;
  finished = true;
  stopPump = true;
  clearInterval(pump);
  try { ws?.readyState === 1 && ws.send(JSON.stringify({ type: 'session.end' })); } catch {}
  setTimeout(() => { try { ws?.close(); } catch {} }, 1500).unref?.();
  const artifact = engine.end();
  artifact.turn_detection = { ...turnDetection, transcription_mode: args.tmode, label: args.label, reason };
  const dir = join(ROOT, args.outdir);
  mkdirSync(dir, { recursive: true });
  const out = join(dir, `artifact-${args.guion}-${noiseCondition}-${args.label}.json`);
  writeFileSync(out, JSON.stringify(artifact, null, 2));
  const evs = artifact.events;
  const count = (ty) => evs.filter((e) => e.type === ty).length;
  console.log(`\n[realgate:${reason}] ${out}`);
  console.log(`  turnos user=${count('user_turn_end')} agent=${count('agent_turn_end')} tools=${count('tool_call')} confirm=${count('confirm_result')} barge_in=${count('barge_in')} errores=${count('session_error')}`);
  console.log(`  ficha: ${artifact.final_form.piezas.map((p) => `${p.sku}x${p.qty}${p.confirmada ? '✓' : '?'}`).join(' · ') || '(sin piezas)'} · tiempo=${artifact.final_form.tiempo_minutos ?? '?'}min · estado=${artifact.final_form.estado}`);
  console.log(`  métricas: node metrics/cli.js ${JSON.stringify(out)} --gt data/ground-truth/gt-${args.guion}.json`);
  setTimeout(() => process.exit(0), 1800).unref?.();
}

process.on('SIGINT', () => finish('sigint'));
run().catch((e) => { console.error(`FALLO: ${e.message}`); finish('error'); });

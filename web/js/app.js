/**
 * app.js — orquestador de UI (browser only). ESM, sin dependencias.
 *
 * Pantallas: consentimiento → panel (dashboard) → orden+guion → sesión → cierre.
 * Alimenta el DOM desde los eventos del canal (mock/real) y del session-engine;
 * el artefacto §6 se POSTea a /api/sessions al cerrar y de ahí se exporta.
 *
 * Privacidad por diseño: el micrófono SOLO se abre en modo real (token real de
 * /api/token); en mock todo es texto simulado. El audio vive en memoria del
 * navegador y se suelta al cerrar la sesión (nunca se sube).
 */
import { createStore } from './store.js';
import { createToolRunner } from './tool-runner.js';
import { createSessionEngine } from './session-engine.js';
import { createMockAgentChannel } from './mock-agent.js';
import { createRealAgentChannel } from './ws-agent.js';
import { buildToolDefinitions } from './tools.js';
import { prepareGuion } from './guion-sim.js';
import { createIncidentStore } from './domain/incident/store.js';
import { createIncidentToolRunner } from './domain/incident/tool-runner.js';
import { createIncidentMockAgentChannel } from './domain/incident/mock-agent.js';
import { buildIncidentToolDefinitions } from './domain/incident/tools.js';
import { prepareIncidentGuion } from './domain/incident/guion-sim.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const state = {
  mode: 'mock', token: null, ordenes: [], piezas: [], guiones: [],
  incidentes: [], servicios: [], guionesIncidente: [],
  domain: 'incidente', // 'incidente' (Plan B, default) | 'orden' (legado)
  orderId: null, guion: null, gt: null,
  channel: null, engine: null, store: null,
  timerHandle: null, agentBubbleEl: null, partialBubbleEl: null, ended: false,
  artifact: null, pendingConfirm: null, editing: null,
  exportFallbackWired: false, exportPanelNative: false,
};

/* Mapping tool → campo que alimenta. La línea de auditoría de cada tarjeta se
 * deriva de engine.events (la misma lista que va al artefacto §6). */
const TOOL_FIELD = {
  set_problema: 'problema',
  set_diagnostico: 'diagnostico',
  set_solucion: 'solucion',
  set_notas: 'notas',
  get_tiempo_trabajo: 'tiempo_minutos',
  agregar_pieza_a_reporte: 'piezas',
  set_resumen: 'resumen',
  set_que_paso: 'que_paso',
  agregar_evento_timeline: 'timeline',
  agregar_servicio_afectado: 'servicios_afectados',
  agregar_action_item: 'action_items',
  set_severidad: 'severidad',
};
const FIELD_LABEL = {
  problema: 'Problema', diagnostico: 'Diagnóstico', solucion: 'Solución',
  piezas: 'Piezas', tiempo_minutos: 'Tiempo', notas: 'Notas',
  resumen: 'Resumen', que_paso: 'Qué pasó', timeline: 'Timeline',
  servicios_afectados: 'Servicios', action_items: 'Pendientes',
  severidad: 'Severidad',
};
const AUDIT_LABEL = {
  form_update: 'ficha actualizada',
  edicion_manual: 'edición manual',
  pieza_agregada: 'pieza agregada',
  pieza_confirmada: 'pieza confirmada',
  pieza_rechazada: 'pieza rechazada',
  orden_cargada: 'orden cargada',
  busqueda_pieza: 'búsqueda de pieza',
  set_problema: 'problema (tool)',
  set_diagnostico: 'diagnóstico (tool)',
  set_solucion: 'solución (tool)',
  set_notas: 'notas (tool)',
  inicio_trabajo: 'inicio de trabajo',
  tiempo_consultado: 'tiempo consultado',
  reporte_enviado: 'reporte enviado',
  tool_desconocida: 'tool desconocida',
  incidente_cargado: 'incidente cargado',
  busqueda_servicio: 'búsqueda de servicio',
  servicio_agregado: 'servicio agregado',
  servicio_confirmado: 'servicio confirmado',
  servicio_rechazado: 'servicio rechazado',
  evento_agregado: 'evento agregado',
  hora_corregida: 'hora corregida',
  action_item_agregado: 'pendiente agregado',
  set_resumen: 'resumen (tool)',
  set_que_paso: 'qué pasó (tool)',
  severidad_fijada: 'severidad (tool)',
};
const PRIORIDAD_CLASE = { alta: 'chip-alta', media: 'chip-media', baja: 'chip-baja' };
const ESTADO_CLASE = { abierta: 'chip-open', en_proceso: 'chip-wip', enviada: 'chip-done' };
const SEVERIDAD_CLASE = { baja: 'chip-open', media: 'chip-media', alta: 'chip-alta', critica: 'chip-alta' };

const orderButtons = new Map();    // id orden → botón del picker
const scenarioButtons = new Map(); // scenario_id → botón del picker

/* ================================================================== */
/* Boot                                                               */
/* ================================================================== */

async function boot() {
  wireConsent();
  await Promise.all([
    loadToken(), loadOrdenes(), loadPiezas(), loadGuiones(),
    loadIncidentes(), loadServicios(), loadGuionesIncidente(),
  ]);
  renderOrders();
  renderScenarios();
  renderDashOrders();
  wireModeSwitch();
  wireDashboard();
  wireSetup();
  wireSessionControls();
  wireEditableFields();
  wireEndControls();
  applyDomain();
}
boot().catch((err) => console.error('[app] boot:', err));

async function fetchJson(url, opts) {
  const r = await fetch(url, opts);
  if (!r.ok) throw new Error(`${url} → HTTP ${r.status}`);
  return r.json();
}

async function loadPiezas() {
  try { state.piezas = await fetchJson('/data/piezas.json'); } catch { state.piezas = []; }
}

async function loadIncidentes() {
  try { state.incidentes = await fetchJson('/data/incidentes.json'); } catch { state.incidentes = []; }
}

async function loadServicios() {
  try { state.servicios = await fetchJson('/data/servicios.json'); } catch { state.servicios = []; }
}

/* ---------------------------- pantallas ---------------------------- */

function show(screenId) {
  for (const s of document.querySelectorAll('.screen')) s.hidden = s.id !== screenId;
}

function wireConsent() {
  $('btn-consent').addEventListener('click', () => showDashboard());
}

async function loadToken() {
  const badge = $('mode-badge');
  try {
    const t = await fetchJson('/api/token', { method: 'POST' });
    state.mode = t.mode === 'real' ? 'real' : 'mock';
    state.token = t.token ?? null;
  } catch {
    state.mode = 'mock'; // sin backend (file:// o caída): mock local
    state.token = null;
  }
  badge.textContent = state.mode === 'real' ? 'modo REAL (voz)' : 'modo mock (texto)';
  badge.classList.toggle('badge-real', state.mode === 'real');
  badge.classList.toggle('badge-mock', state.mode !== 'real');
  badge.hidden = false;
}

async function loadOrdenes() {
  try { state.ordenes = await fetchJson('/data/ordenes.json'); } catch { state.ordenes = []; }
}

async function loadGuiones() {
  const KNOWN = ['s1-happy-path', 's2-pieza-mal-oida', 's3-barge-in'];
  const found = [];
  for (const sid of KNOWN) {
    try {
      const g = await fetchJson(`/data/guiones/${sid}.json`);
      found.push(g);
      try { state.gt = state.gt ?? {}; state.gt[sid] = await fetchJson(`/data/ground-truth/gt-${sid}.json`); } catch { /* GT opcional */ }
    } catch { /* guion ausente */ }
  }
  state.guiones = found;
}

async function loadGuionesIncidente() {
  const KNOWN = ['i1-dictado-feliz', 'i2-servicio-confundido', 'i3-correccion-hora'];
  const found = [];
  for (const sid of KNOWN) {
    try {
      const g = await fetchJson(`/data/guiones-incidente/${sid}.json`);
      found.push(g);
      try { state.gt = state.gt ?? {}; state.gt[sid] = await fetchJson(`/data/ground-truth-incidente/gt-${sid}.json`); } catch { /* GT opcional */ }
    } catch { /* guion ausente */ }
  }
  state.guionesIncidente = found;
}

/* ================================================================== */
/* Panel (dashboard): órdenes sembradas + sesiones completadas         */
/* ================================================================== */

function wireDashboard() {
  $('btn-setup-back').addEventListener('click', () => showDashboard());
  $('btn-back-dashboard').addEventListener('click', () => showDashboard());
}

function showDashboard() {
  show('screen-dashboard');
  loadSessions();
}

function renderDashOrders() {
  const ul = $('dash-orders');
  ul.textContent = '';
  if (!state.ordenes.length) {
    ul.append(mutedLi('Sin /data/ordenes.json — sirve el repo con el server de desarrollo.'));
    return;
  }
  for (const o of state.ordenes) {
    const li = document.createElement('li');
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'dash-order';
    b.innerHTML =
      `<span class="dash-top"><span class="mono">${esc(o.id)}</span>` +
      `<span class="chip ${PRIORIDAD_CLASE[o.prioridad] ?? ''}">${esc(o.prioridad ?? '—')}</span>` +
      `<span class="chip ${ESTADO_CLASE[o.estado] ?? 'chip-open'}">${esc(o.estado ?? '—')}</span></span>` +
      `<strong>${esc(o.cliente)}</strong><small>${esc(o.equipo)}</small>`;
    b.addEventListener('click', () => pickOrder(o));
    li.append(b);
    ul.append(li);
  }
}

/** Click en una orden del panel (legado): modo orden + preselección. */
function pickOrder(o) {
  setDomain('orden');
  state.orderId = o.id;
  for (const [id, btn] of orderButtons) btn.setAttribute('aria-pressed', String(id === o.id));
  selectScenario(state.guiones.find((g) => g.order_id === o.id) ?? null);
  show('screen-setup');
}

async function loadSessions() {
  const ul = $('dash-sessions');
  ul.textContent = '';
  ul.append(mutedLi('Cargando sesiones…'));
  let sessions = null;
  try {
    const r = await fetchJson('/api/sessions');
    sessions = Array.isArray(r?.sessions) ? r.sessions : [];
  } catch { sessions = null; }
  ul.textContent = '';
  if (sessions === null) {
    ul.append(mutedLi('Sesiones no disponibles (GET /api/sessions sin respuesta).'));
    return;
  }
  if (!sessions.length) {
    ul.append(mutedLi('Aún no hay sesiones completadas — corre una demo y aparecerá aquí.'));
    return;
  }
  for (const s of sessions) {
    const li = document.createElement('li');
    li.className = 'dash-session';
    li.innerHTML =
      `<span class="dash-top"><strong class="mono">${esc(s.scenario_id ?? 'sin guion')}</strong>` +
      `<span class="chip ${s.mode === 'real' ? 'chip-done' : 'chip-wip'}">${esc(s.mode ?? '—')}</span></span>` +
      `<small>${esc(s.order_id ?? '—')} · ${esc(fmtStarted(s.started_at))} · ${esc(fmtDuracion(s))}</small>`;
    ul.append(li);
  }
}

function fmtStarted(iso) {
  if (!iso) return 'fecha n/d';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? String(iso)
    : d.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });
}
function fmtDuracion(s) {
  const a = s?.started_at ? new Date(s.started_at) : null;
  const b = s?.ended_at ? new Date(s.ended_at) : null;
  if (!a || !b || Number.isNaN(a) || Number.isNaN(b) || b < a) return 'duración n/d';
  return `duró ${fmtMs(b - a)}`;
}
function fmtMs(ms) {
  const sec = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
}

function mutedLi(text) {
  const li = document.createElement('li');
  li.className = 'muted';
  li.textContent = text;
  return li;
}

/* ================================================================== */
/* Setup: modo (incidente|orden) + caso + guion                        */
/* ================================================================== */

/** Datos del dominio activo: casos (órdenes|incidentes) y guiones. */
function activeCases() { return state.domain === 'orden' ? state.ordenes : state.incidentes; }
function activeGuiones() { return state.domain === 'orden' ? state.guiones : state.guionesIncidente; }
/** id del caso al que pertenece un guion (order_id | incidente_id). */
function caseIdOfGuion(g) { return g?.order_id ?? g?.incidente_id ?? null; }

function setDomain(domain) {
  if (state.domain === domain) return;
  state.domain = domain;
  applyDomain();
}

/** Aplica el dominio activo a la pantalla de setup y re-renderiza listas. */
function applyDomain() {
  const incidente = state.domain === 'incidente';
  $('btn-mode-incidente').setAttribute('aria-pressed', String(incidente));
  $('btn-mode-orden').setAttribute('aria-pressed', String(!incidente));
  $('picker-case-title').textContent = incidente ? 'Incidente' : 'Orden de trabajo';
  state.orderId = null;
  state.guion = null;
  renderOrders();
  renderScenarios();
  refreshStartBtn();
}

function wireModeSwitch() {
  $('btn-mode-incidente').addEventListener('click', () => setDomain('incidente'));
  $('btn-mode-orden').addEventListener('click', () => setDomain('orden'));
}

function renderOrders() {
  const ul = $('order-list');
  ul.textContent = '';
  orderButtons.clear();
  const casos = activeCases();
  if (!casos.length) {
    ul.append(mutedLi(state.domain === 'orden'
      ? 'Sin /data/ordenes.json — sirve el repo con un server estático.'
      : 'Sin /data/incidentes.json — sirve el repo con el server de desarrollo.'));
    return;
  }
  for (const o of casos) {
    const li = document.createElement('li');
    const b = document.createElement('button');
    b.type = 'button';
    b.innerHTML = state.domain === 'orden'
      ? `<strong>${esc(o.id)}</strong> · ${esc(o.cliente)}<small>${esc(o.equipo)} — ${esc(o.problema_reportado)}</small>`
      : `<strong>${esc(o.id)}</strong> · ${esc(o.cliente)}<small>${esc(o.reporte_inicial ?? o.equipo ?? '')}</small>`;
    b.setAttribute('aria-pressed', 'false');
    b.addEventListener('click', () => {
      state.orderId = o.id;
      for (const [id, btn] of orderButtons) btn.setAttribute('aria-pressed', String(id === o.id));
      refreshStartBtn();
    });
    orderButtons.set(o.id, b);
    li.append(b);
    ul.append(li);
  }
}

function renderScenarios() {
  const ul = $('scenario-list');
  ul.textContent = '';
  scenarioButtons.clear();
  const guiones = activeGuiones();
  if (!guiones.length) {
    ul.append(mutedLi(state.domain === 'orden'
      ? 'Sin guiones en /data/guiones/.'
      : 'Sin guiones en /data/guiones-incidente/.'));
    return;
  }
  for (const g of guiones) {
    const li = document.createElement('li');
    const b = document.createElement('button');
    b.type = 'button';
    b.innerHTML = `<strong>${esc(g.scenario_id)}</strong> · ${esc(caseIdOfGuion(g))}<small>${esc((g.description ?? '').slice(0, 90))}…</small>`;
    b.setAttribute('aria-pressed', 'false');
    b.addEventListener('click', () => selectScenario(g));
    scenarioButtons.set(g.scenario_id, b);
    li.append(b);
    ul.append(li);
  }
}

function selectScenario(g) {
  state.guion = g;
  for (const [id, btn] of scenarioButtons) btn.setAttribute('aria-pressed', String(!!g && id === g.scenario_id));
  const d = $('scenario-desc');
  d.textContent = g?.description ?? '';
  d.hidden = !g?.description;
  refreshStartBtn();
}

function refreshStartBtn() {
  const casoId = caseIdOfGuion(state.guion);
  const guionMatchesOrder = !state.guion || !state.orderId || casoId === state.orderId;
  const err = $('setup-error');
  if (state.orderId && state.guion && !guionMatchesOrder) {
    const sustantivo = state.domain === 'orden' ? 'la orden' : 'el incidente';
    err.textContent = `El guion ${state.guion.scenario_id} va con ${sustantivo} ${casoId}; elige ese.`;
    err.hidden = false;
  } else err.hidden = true;
  $('btn-start-session').disabled = !(state.orderId && state.guion && guionMatchesOrder);
}

function wireSetup() {
  $('btn-start-session').addEventListener('click', () => startSession());
}

/* ================================================================== */
/* Sesión                                                             */
/* ================================================================== */

function resetSessionUi() {
  $('transcript').textContent = '';
  $('session-status').hidden = true;
  hideReadbackBanner();
  $('cronometro').textContent = '00:00';
  $('session-ot').textContent = '—';
  $('session-estado').textContent = '—';
  state.agentBubbleEl = null;
  state.partialBubbleEl = null;
  state.editing = null;
  state.artifact = null;
}

async function startSession() {
  show('screen-session');
  resetSessionUi();
  state.ended = false;
  const gt = state.gt?.[state.guion.scenario_id] ?? null;
  const incidente = state.domain === 'incidente';

  let channel;
  let store;
  let runner;
  if (incidente) {
    const guion = prepareIncidentGuion(state.guion, gt, state.servicios);
    const tools = buildIncidentToolDefinitions(state.servicios.map((s) => s.id));
    if (state.mode === 'real' && state.token) {
      channel = createRealAgentChannel({ token: state.token, tools });
    } else {
      channel = createIncidentMockAgentChannel({
        incidentes: state.incidentes, servicios: state.servicios, guion, speed: 1,
      });
    }
    const clock = channel.clock;
    store = createIncidentStore({ incidenteId: state.guion.incidente_id ?? state.orderId, now: () => clock.now() });
    runner = createIncidentToolRunner({ incidentes: state.incidentes, servicios: state.servicios, store, clock });
    state.channel = channel;
    state.store = store;
    state.engine = createSessionEngine({
      channel, toolRunner: runner, store,
      meta: {
        session_id: `sess_${new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 15)}`,
        scenario_id: state.guion.scenario_id, mode: state.mode,
        order_id: state.guion.incidente_id ?? state.orderId,
        noise_condition: state.guion.ambiente ?? 'tranquilo',
      },
      clock,
      onEvent: (type) => {
        if (['tool_call', 'tool_result', 'confirm_result', 'form_update', 'report_sent'].includes(type)) renderForm();
      },
    });
  } else {
    const guion = prepareGuion(state.guion, gt);
    const tools = buildToolDefinitions(state.piezas.map((p) => p.sku));
    if (state.mode === 'real' && state.token) {
      channel = createRealAgentChannel({ token: state.token, tools });
    } else {
      channel = createMockAgentChannel({
        ordenes: state.ordenes, piezas: state.piezas, guion, speed: 1,
      });
    }
    const clock = channel.clock;
    store = createStore({ orderId: state.guion.order_id ?? state.orderId, now: () => clock.now() });
    runner = createToolRunner({ ordenes: state.ordenes, piezas: state.piezas, store, clock });
    state.channel = channel;
    state.store = store;
    state.engine = createSessionEngine({
      channel, toolRunner: runner, store,
      meta: {
        session_id: `sess_${new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 15)}`,
        scenario_id: state.guion.scenario_id, mode: state.mode,
        order_id: state.guion.order_id ?? state.orderId,
        noise_condition: state.guion.noise_condition ?? 'clean',
      },
      clock,
      onEvent: (type) => {
        if (['tool_call', 'tool_result', 'confirm_result', 'form_update', 'report_sent'].includes(type)) renderForm();
      },
    });
  }

  $('ficha').hidden = incidente;
  $('ficha-incidente').hidden = !incidente;
  wireSessionUi(channel);
  renderForm();
  state.engine.start();
  startCronometro();

  try {
    await channel.start();
  } catch (err) {
    setStatus(`Error al iniciar el canal: ${err?.message ?? err}`, true);
  }
}

function wireSessionUi(channel) {
  const appendBubble = (role, text, cls = '') => {
    const div = document.createElement('div');
    div.className = `bubble ${role} ${cls}`;
    const who = document.createElement('span');
    who.className = 'who';
    who.textContent = role === 'user' ? 'Técnico' : 'Agente';
    const txt = document.createElement('span');
    txt.className = 'txt';
    txt.textContent = text;
    div.append(who, txt);
    $('transcript').append(div);
    $('transcript').scrollTop = $('transcript').scrollHeight;
    div._txt = txt;
    return div;
  };
  const setBubbleText = (el, text) => {
    if (el?._txt) el._txt.textContent = text;
    $('transcript').scrollTop = $('transcript').scrollHeight;
  };
  let agentText = '';

  /* Turno del técnico: burbuja parcial (gris/cursiva) mientras llega el
   * streaming; se consolida con el user_turn_end. */
  channel.on('user_turn_start', () => {
    state.agentBubbleEl = null;
    state.partialBubbleEl = appendBubble('user', '…', 'partial');
  });
  channel.on('user_turn_delta', (d) => {
    if (state.partialBubbleEl) setBubbleText(state.partialBubbleEl, d.text ?? '');
  });
  channel.on('user_turn_end', (d) => {
    if (state.partialBubbleEl) {
      setBubbleText(state.partialBubbleEl, d.text);
      state.partialBubbleEl.classList.remove('partial');
      state.partialBubbleEl = null;
    } else appendBubble('user', d.text);
  });

  /* Turno del agente: chunks que se van pegando a la burbuja. */
  channel.on('agent_turn_start', () => {
    agentText = '';
    state.agentBubbleEl = appendBubble('agent', '…');
  });
  channel.on('agent_turn_text', (d) => {
    if (!state.agentBubbleEl) { agentText = ''; state.agentBubbleEl = appendBubble('agent', ''); }
    agentText += d.text ?? '';
    setBubbleText(state.agentBubbleEl, agentText);
  });
  channel.on('agent_turn_end', (d) => {
    if (state.agentBubbleEl) {
      setBubbleText(state.agentBubbleEl, d.text ?? agentText);
      if (d.interrupted) state.agentBubbleEl.classList.add('interrupted');
    } else appendBubble('agent', d.text ?? '', d.interrupted ? 'interrupted' : '');
    state.agentBubbleEl = null;
  });
  channel.on('barge_in', (d) => {
    appendBubble('agent', `✋ ${d.agent_text_cut} (interrumpido, ${d.latency_ms} ms)`, 'interrupted');
    state.agentBubbleEl = null;
  });
  channel.on('confirm_request', (d) => showReadbackBanner(d));
  channel.on('confirm_result', (d) => {
    if (d.confirmed) hideReadbackBanner();
    else showReadbackBanner(d, 'Rechazada por el técnico — corrigiendo…');
  });
  channel.on('report_sent', () => {
    hideReadbackBanner();
    setStatus('Reporte enviado. Puedes terminar la sesión para ver la ficha final.');
  });
  channel.on('error', (d) => setStatus(`Error de sesión: ${d.code} — ${d.message}`, true));
  channel.on('ended', () => { if (!state.ended) finishSession(); });
}

/* ---------------------------- read-back ---------------------------- */

function showReadbackBanner(data, label) {
  state.pendingConfirm = data ?? null;
  const b = $('readback-banner');
  const t = $('readback-text');
  const v = data?.value ?? {};
  let pregunta = label;
  if (pregunta == null) {
    if (data?.field === 'hora') {
      const horas = Array.isArray(v) ? v : (v ? [v] : []);
      pregunta = `¿Confirmo ${horas.length > 1 ? 'esas horas' : `el evento a las ${horas[0] ?? '?'}`}?`;
    } else if (data?.field === 'severidad') {
      const sev = typeof v === 'string' ? v : v?.severidad;
      pregunta = `¿Confirmo severidad ${String(sev ?? '?').toUpperCase()}?`;
    } else {
      pregunta = `¿Decías ${v.nombre ?? 'el servicio'}?`;
    }
  }
  t.textContent = pregunta;
  b.hidden = false;
  b.classList.add('pendiente');
}
function hideReadbackBanner() {
  state.pendingConfirm = null;
  const b = $('readback-banner');
  b.hidden = true;
  b.classList.remove('pendiente');
}

/* ------------------------ ficha viva + auditoría ------------------- */

/** confirm_result (canal) → campo de la ficha que deja huella. */
const CONFIRM_FIELD = {
  pieza: 'piezas',
  servicio: 'servicios_afectados',
  hora: 'timeline',
  severidad: 'severidad',
};

/**
 * Último setter de un campo, escaneando engine.events hacia atrás (la misma
 * lista que termina en el artefacto §6): tool_result / confirm_result /
 * form_update manual. Fuente única, sin estado paralelo en la UI.
 */
function fieldTrailOf(field) {
  const evs = state.engine?.events ?? [];
  for (let i = evs.length - 1; i >= 0; i--) {
    const e = evs[i];
    if (e.type === 'tool_result' && e.ok !== false && TOOL_FIELD[e.tool] === field) {
      return { kind: 'tool', label: e.tool, t_ms: e.t_ms };
    }
    if (e.type === 'confirm_result' && field === CONFIRM_FIELD[e.field]) {
      return e.confirmed
        ? { kind: 'confirm', label: 'confirmación por voz', t_ms: e.t_ms }
        : { kind: 'correct', label: 'corrección por voz', t_ms: e.t_ms };
    }
    if (e.type === 'form_update' && e.why === 'manual' && (e.changed ?? []).includes(field)) {
      return { kind: 'manual', label: 'edición manual', t_ms: e.t_ms };
    }
  }
  return null;
}

function renderForm() {
  const f = state.store?.final_form;
  if (!f) return;
  const editable = !state.ended && f.estado !== 'enviada';
  const incidente = state.domain === 'incidente';

  $('session-ot').textContent = f.order_id ?? f.incidente_id ?? '—';
  const est = $('session-estado');
  est.textContent = f.estado;
  est.className = `chip ${ESTADO_CLASE[f.estado] ?? 'chip-wip'}`;

  const fichaEl = incidente ? $('ficha-incidente') : $('ficha');
  const setValue = (field, text) => {
    const el = fichaEl.querySelector(`.field-value[data-value="${field}"]`);
    if (!el) return;
    el.contentEditable = editable ? 'true' : 'false';
    el.closest('.field-card')?.classList.toggle('editable', editable);
    if (state.editing !== field) el.textContent = text;
  };

  if (incidente) {
    setValue('resumen', f.resumen || '—');
    setValue('que_paso', f.que_paso || '—');
    setValue('severidad', f.severidad ?? '—');
    renderTimeline(f.timeline, editable);
    renderServicios(f.servicios_afectados, editable);
    renderActionItems(f.action_items, editable);
  } else {
    setValue('problema', f.problema || '—');
    setValue('diagnostico', f.diagnostico || '—');
    setValue('solucion', f.solucion || '—');
    setValue('tiempo_minutos', f.tiempo_minutos != null ? `${f.tiempo_minutos} min` : '—');
    setValue('notas', f.notas || '—');
    renderPiezas(f.piezas, editable);
  }
  renderFieldAudits();
  renderAuditTrail();
}

function renderFieldAudits() {
  const fichaEl = state.domain === 'incidente' ? $('ficha-incidente') : $('ficha');
  if (!fichaEl) return;
  for (const el of fichaEl.querySelectorAll('[data-audit]')) {
    const field = el.dataset.audit;
    const tr = fieldTrailOf(field);
    if (!tr) {
      el.className = 'field-audit muted';
      el.textContent = 'esperando…';
      continue;
    }
    const when = tr.t_ms != null ? `${(tr.t_ms / 1000).toFixed(1)} s` : '';
    el.className = `field-audit ${tr.kind}`;
    el.innerHTML = tr.kind === 'tool'
      ? `tool <code>${esc(tr.label)}</code> · ${when}`
      : `${esc(tr.label)} · ${when}`;
  }
}

function renderPiezas(piezas, editable) {
  const ul = document.querySelector('#ficha [data-value="piezas"]');
  if (!ul) return;
  if (state.editing === 'piezas') return; // no pisar los inputs con foco
  ul.classList.toggle('editable', editable);
  ul.textContent = '';
  if (!piezas.length) {
    const li = document.createElement('li');
    li.className = 'muted';
    li.textContent = '— sin piezas todavía —';
    ul.append(li);
    return;
  }
  for (const p of piezas) {
    const trail = piezaTrail(p.sku);
    const li = document.createElement('li');
    li.className = 'pieza-row';
    li.innerHTML =
      `<span class="pieza-badge ${p.confirmada ? 'ok' : 'pend'}" ` +
      `title="${p.confirmada ? 'confirmada por voz' : 'confirmación pendiente'}">${p.confirmada ? '✓' : '⏳'}</span>` +
      `<span class="pieza-info"><strong>${esc(p.nombre)}</strong><code>${esc(p.sku)}</code>` +
      (trail ? `<span class="pieza-trail">${esc(trail)}</span>` : '') + '</span>';
    const lab = document.createElement('label');
    lab.className = 'pieza-qty';
    lab.textContent = '× ';
    const qty = document.createElement('input');
    qty.type = 'number';
    qty.min = '1';
    qty.step = '1';
    qty.value = String(p.qty);
    qty.disabled = !editable;
    qty.title = 'Cambiar cantidad (edición manual)';
    qty.addEventListener('change', () => commitPiezasQty(p.sku, qty.value));
    lab.append(qty);
    const rm = document.createElement('button');
    rm.type = 'button';
    rm.className = 'pieza-quitar';
    rm.textContent = '✕';
    rm.title = 'Quitar pieza (edición manual)';
    rm.disabled = !editable;
    rm.addEventListener('click', () => commitPiezasRemove(p.sku));
    li.append(lab, rm);
    ul.append(li);
  }
}

/** Última huella de una pieza en los eventos: agregada / confirmada / corregida. */
function piezaTrail(sku) {
  const evs = state.engine?.events ?? [];
  const parts = [];
  for (const e of evs) {
    if (e.type === 'tool_result' && e.tool === 'agregar_pieza_a_reporte' && e.result?.sku === sku) {
      parts.push(`agregada ${(e.t_ms / 1000).toFixed(1)} s`);
    } else if (e.type === 'confirm_result' && e.value?.sku === sku) {
      parts.push(`${e.confirmed ? 'confirmada' : 'corregida'} ${(e.t_ms / 1000).toFixed(1)} s`);
    }
  }
  return parts.slice(-2).join(' · ');
}

/* ---------------- ficha incidente: filas por campo ---------------- */

/** Timeline: una fila por evento, hora en mono + texto del operador. */
function renderTimeline(timeline, editable) {
  const ul = $('ficha-incidente')?.querySelector('[data-value="timeline"]');
  if (!ul) return;
  if (state.editing === 'timeline') return;
  ul.classList.toggle('editable', editable);
  ul.textContent = '';
  if (!timeline.length) {
    const li = document.createElement('li');
    li.className = 'muted';
    li.textContent = '— sin eventos todavía —';
    ul.append(li);
    return;
  }
  for (const ev of [...timeline].sort((a, b) => String(a.hora).localeCompare(String(b.hora)))) {
    const li = document.createElement('li');
    li.className = 'pieza-row';
    li.innerHTML =
      `<span class="mono" style="font-weight:700">${esc(ev.hora)}</span>` +
      `<span class="pieza-info"><span style="font-size:0.88rem">${esc(ev.evento)}</span></span>`;
    li.append(botonQuitar('Quitar evento (edición manual)', editable, () => {
      commitManualArray('timeline', (rows) => rows.filter((r) => r.hora !== ev.hora));
    }));
    ul.append(li);
  }
}

/** Servicios afectados: chips con ✓/⏳ de confirmación por voz. */
function renderServicios(servicios, editable) {
  const ul = $('ficha-incidente')?.querySelector('[data-value="servicios_afectados"]');
  if (!ul) return;
  if (state.editing === 'servicios_afectados') return;
  ul.classList.toggle('editable', editable);
  ul.textContent = '';
  if (!servicios.length) {
    const li = document.createElement('li');
    li.className = 'muted';
    li.textContent = '— sin servicios todavía —';
    ul.append(li);
    return;
  }
  for (const s of servicios) {
    const trail = servicioTrail(s.id);
    const li = document.createElement('li');
    li.className = 'pieza-row';
    li.innerHTML =
      `<span class="pieza-badge ${s.confirmado ? 'ok' : 'pend'}" ` +
      `title="${s.confirmado ? 'confirmado por voz' : 'confirmación pendiente'}">${s.confirmado ? '✓' : '⏳'}</span>` +
      `<span class="pieza-info"><strong>${esc(s.nombre ?? s.id)}</strong><code>${esc(s.id)}</code>` +
      (s.afectados != null ? `<span class="pieza-trail">${esc(s.afectados)} afectados</span>` : '') +
      (trail ? `<span class="pieza-trail">${esc(trail)}</span>` : '') + '</span>';
    li.append(botonQuitar('Quitar servicio (edición manual)', editable, () => {
      commitManualArray('servicios_afectados', (rows) => rows.filter((r) => r.id !== s.id));
    }));
    ul.append(li);
  }
}

/** Pendientes: una fila por action item. */
function renderActionItems(items, editable) {
  const ul = $('ficha-incidente')?.querySelector('[data-value="action_items"]');
  if (!ul) return;
  if (state.editing === 'action_items') return;
  ul.classList.toggle('editable', editable);
  ul.textContent = '';
  if (!items.length) {
    const li = document.createElement('li');
    li.className = 'muted';
    li.textContent = '— sin pendientes —';
    ul.append(li);
    return;
  }
  for (const [idx, item] of items.entries()) {
    const li = document.createElement('li');
    li.className = 'pieza-row';
    li.innerHTML = `<span class="pieza-info"><span style="font-size:0.88rem">${esc(item)}</span></span>`;
    li.append(botonQuitar('Quitar pendiente (edición manual)', editable, () => {
      commitManualArray('action_items', (rows) => rows.filter((_, i) => i !== idx));
    }));
    ul.append(li);
  }
}

function botonQuitar(title, editable, onClick) {
  const rm = document.createElement('button');
  rm.type = 'button';
  rm.className = 'pieza-quitar';
  rm.textContent = '✕';
  rm.title = title;
  rm.disabled = !editable;
  rm.addEventListener('click', onClick);
  return rm;
}

/** Última huella de un servicio: agregado / confirmado / corregido por voz. */
function servicioTrail(id) {
  const evs = state.engine?.events ?? [];
  const parts = [];
  for (const e of evs) {
    if (e.type === 'tool_result' && e.tool === 'agregar_servicio_afectado' && e.result?.id === id) {
      parts.push(`agregado ${(e.t_ms / 1000).toFixed(1)} s`);
    } else if (e.type === 'confirm_result' && e.value?.id === id) {
      parts.push(`${e.confirmed ? 'confirmado' : 'corregido'} ${(e.t_ms / 1000).toFixed(1)} s`);
    }
  }
  return parts.slice(-2).join(' · ');
}

/** Edición manual de un campo-arreglo del incidente (timeline/servicios/items). */
function commitManualArray(field, mutator) {
  const f = state.store?.final_form;
  if (!f || state.ended || f.estado === 'enviada') return;
  const next = JSON.parse(JSON.stringify(f[field] ?? []));
  mutator(next);
  const { changed } = state.store.applyManualEdit(field, next);
  if (changed.length) {
    recordManualFormUpdate(changed);
    setStatus(`Edición manual guardada: ${FIELD_LABEL[field] ?? field}.`);
  }
  renderForm();
}

function renderAuditTrail() {
  const trail = $('audit-trail');
  if (!trail) return;
  trail.textContent = '';
  for (const a of [...(state.store?.audit ?? [])].slice(-40).reverse()) {
    const li = document.createElement('li');
    const t = a.t_ms != null ? `${(a.t_ms / 1000).toFixed(1)}s` : '';
    const label = AUDIT_LABEL[a.action] ?? esc(a.action);
    const changed = a.changed?.length ? ` <code>[${a.changed.join(',')}]</code>` : '';
    const sku = a.sku ? ` ${esc(a.sku)}` : '';
    li.innerHTML = `<code>${t}</code> ${label}${changed}${sku}`;
    trail.append(li);
  }
}

/* --------------------- edición ligera (manual) --------------------- */

function wireEditableFields() {
  for (const el of document.querySelectorAll('.ficha .field-value[data-value]')) {
    const field = el.dataset.value;
    if (ARRAY_FIELDS.includes(field)) continue; // arreglos: edición por fila (botones)
    el.addEventListener('focus', () => {
      state.editing = field;
      el.classList.add('editing');
      if (el.textContent === '—') el.textContent = '';
    });
    el.addEventListener('blur', () => {
      el.classList.remove('editing');
      state.editing = null;
      commitFieldEdit(field, el);
    });
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); el.blur(); }
      else if (e.key === 'Escape') { el.textContent = currentFieldValue(field); el.blur(); }
    });
    el.addEventListener('paste', (e) => {
      e.preventDefault();
      const t = (e.clipboardData?.getData('text/plain') ?? '').replace(/\s+/g, ' ');
      document.execCommand('insertText', false, t);
    });
  }
  for (const field of ARRAY_FIELDS) {
    const ul = document.querySelector(`.ficha [data-value="${field}"]`);
    ul?.addEventListener('focusin', () => { state.editing = field; });
    ul?.addEventListener('focusout', () => {
      setTimeout(() => {
        if (!ul.contains(document.activeElement)) {
          state.editing = null;
          renderForm(); // pinta las filas con el valor ya comprometido
        }
      }, 0);
    });
  }
}

/** Campos-arreglo de la ficha (por dominio): piezas | timeline | servicios | items. */
const ARRAY_FIELDS = ['piezas', 'timeline', 'servicios_afectados', 'action_items'];

function currentFieldValue(field) {
  const f = state.store?.final_form;
  if (!f) return '—';
  if (field === 'tiempo_minutos') return f.tiempo_minutos != null ? `${f.tiempo_minutos} min` : '—';
  return f[field] || '—';
}

function commitFieldEdit(field, el) {
  if (!state.store) { renderForm(); return; }
  if (state.ended || state.store.final_form.estado === 'enviada') { renderForm(); return; }
  const raw = el.textContent.replace(/\s+/g, ' ').trim();
  let value = raw;
  if (field === 'tiempo_minutos') {
    const n = Number.parseInt(raw.replace(/[^\d]/g, ''), 10);
    if (!Number.isFinite(n) || n < 0) {
      setStatus('Tiempo inválido — escribe minutos, p. ej. "45 min".', true);
      renderForm();
      return;
    }
    value = n;
  }
  if (field === 'severidad') {
    const sev = raw.toLowerCase();
    if (!['baja', 'media', 'alta', 'critica'].includes(sev)) {
      setStatus('Severidad inválida — escribe baja, media, alta o critica.', true);
      renderForm();
      return;
    }
    value = sev;
  }
  const { changed } = state.store.applyManualEdit(field, value);
  if (changed.length) {
    recordManualFormUpdate(changed);
    setStatus(`Edición manual guardada: ${FIELD_LABEL[field] ?? field}.`);
  }
  renderForm();
}

function commitPiezasQty(sku, rawVal) {
  const q = Math.round(Number(rawVal));
  if (!Number.isFinite(q) || q < 1) { renderForm(); return; }
  const next = state.store.final_form.piezas.map((p) => (p.sku === sku ? { ...p, qty: q } : p));
  applyManualPiezas(next);
}

function commitPiezasRemove(sku) {
  const next = state.store.final_form.piezas.filter((p) => p.sku !== sku);
  applyManualPiezas(next);
}

function applyManualPiezas(next) {
  const { changed } = state.store.applyManualEdit('piezas', next);
  if (changed.length) {
    recordManualFormUpdate(changed);
    setStatus('Edición manual de piezas guardada — queda en auditoría y en el artefacto.');
  }
  renderForm();
}

/**
 * Las ediciones manuales también viajan en el artefacto: form_update con
 * why:'manual' (mismo shape que las de tools, §6). El engine expone su lista
 * `events` viva, así que el registro se agrega ahí.
 */
function recordManualFormUpdate(changed) {
  if (!state.engine || !changed?.length) return;
  try {
    const t = Math.round(state.channel.clock.now());
    state.engine.events.push({
      t_ms: t,
      type: 'form_update',
      changed: [...changed],
      form: JSON.parse(JSON.stringify(state.store.final_form)),
      why: 'manual',
    });
  } catch { /* sin engine no hay artefacto que actualizar */ }
}

/* ---------------------------- cronómetro --------------------------- */

function startCronometro() {
  stopCronometro();
  const tick = () => {
    if (!state.store || !state.channel) return;
    const now = state.channel.clock.now();
    const start = state.store.workStartedAt ?? now;
    const total = Math.max(0, Math.round((now - start) / 1000));
    $('cronometro').textContent =
      `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
  };
  tick();
  state.timerHandle = setInterval(tick, 500);
}
function stopCronometro() { if (state.timerHandle) clearInterval(state.timerHandle); }

function setStatus(msg, isError = false) {
  const el = $('session-status');
  el.textContent = msg;
  el.style.color = isError ? 'var(--danger)' : '';
  el.hidden = false;
}

/* ------------------------- controles sesión ------------------------ */

function wireSessionControls() {
  $('btn-next-turn').addEventListener('click', () => state.channel?.send('advance'));
  $('chk-autoreplay').addEventListener('change', (e) => {
    if (state.channel?.isMock) state.channel.autoReplay = e.target.checked;
  });
  $('btn-bargein').addEventListener('click', () => state.channel?.send('interrupt_request'));
  $('free-input-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const input = $('free-input');
    const text = input.value.trim();
    if (text && state.channel) { state.channel.send('user_text', { text }); input.value = ''; }
  });
  $('btn-end-session').addEventListener('click', () => finishSession());

  /* Banner de read-back: los botones son una AYUDA, no el único camino —
   * el turno hablado del guion sigue funcionando igual. */
  $('btn-confirm-yes').addEventListener('click', () => {
    const pc = state.pendingConfirm;
    if (!pc || state.ended) return;
    if (state.channel?.isMock) {
      // inyecta el "sí" como turno del usuario: el canal lo procesa igual
      // que el guion y emite el confirm_result por la vía normal.
      state.channel.send('user_text', { text: 'sí' });
      hideReadbackBanner();
    } else if (state.engine) {
      state.engine.handleEvent('confirm_result', {
        field: pc.field, value: pc.value, confirmed: true,
      });
      hideReadbackBanner();
    }
  });
  $('btn-confirm-edit').addEventListener('click', () => {
    const campo = state.domain === 'incidente' ? 'servicios_afectados' : 'piezas';
    const fichaEl = state.domain === 'incidente' ? $('ficha-incidente') : $('ficha');
    const card = fichaEl?.querySelector(`.field-card[data-field="${campo}"]`);
    if (!card) return;
    card.scrollIntoView({ behavior: 'smooth', block: 'center' });
    card.classList.add('flash');
    setTimeout(() => card.classList.remove('flash'), 1300);
    setStatus(state.domain === 'incidente'
      ? 'Corrige el servicio aquí (quitar) — el agente sigue esperando tu respuesta de voz.'
      : 'Corrige la pieza aquí (cantidad o quitar) — el agente sigue esperando tu respuesta de voz.');
  });
}

/* ================================================================== */
/* Cierre de sesión + export                                          */
/* ================================================================== */

function wireEndControls() {
  $('btn-back-dashboard').addEventListener('click', () => showDashboard());
}

async function finishSession() {
  if (state.ended) return;
  state.ended = true;
  stopCronometro();
  hideReadbackBanner();
  state.editing = null;
  try { await state.channel?.stop?.(); } catch { /* canal ya muerto */ }
  const artifact = state.engine?.end();
  if (!artifact) return;
  state.artifact = artifact;
  renderForm();

  // persistencia server-side (texto, jamás audio)
  let posted = false;
  try {
    const r = await fetch('/api/sessions', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify(artifact),
    });
    posted = r.ok;
  } catch { /* sin backend */ }

  renderEndScreen(artifact);
  const statusEl = $('export-status');
  statusEl.textContent = posted
    ? 'Sesión cerrada y artefacto guardado en /api/sessions (solo texto, sin audio).'
    : 'Sesión cerrada. POST a /api/sessions no disponible — el artefacto se queda local.';
  await wireExportPanel(statusEl);
}

function renderEndScreen(artifact) {
  const f = artifact.final_form;
  const incidente = state.domain === 'incidente';
  $('end-summary-orden').hidden = incidente;
  $('end-summary-incidente').hidden = !incidente;

  const est = $('end-estado');
  est.textContent = f.estado;
  est.className = `chip ${ESTADO_CLASE[f.estado] ?? 'chip-wip'}`;

  if (incidente) {
    const inc = state.incidentes.find((o) => o.id === (f.incidente_id ?? artifact.order_id)) ?? null;
    const set = (k, html) => {
      const el = document.querySelector(`#screen-end [data-i="${k}"]`);
      if (el) el.innerHTML = html;
    };
    set('incidente', esc(f.incidente_id ?? artifact.order_id ?? '—'));
    set('cliente', esc(inc?.cliente ?? '—'));
    set('resumen', esc(f.resumen) || '—');
    set('que_paso', esc(f.que_paso) || '—');
    set('timeline', f.timeline.length
      ? [...f.timeline].sort((a, b) => String(a.hora).localeCompare(String(b.hora)))
        .map((ev) => `<li class="pieza-row mini"><span class="mono" style="font-weight:700">${esc(ev.hora)}</span>` +
          `<span class="pieza-info"><span style="font-size:0.88rem">${esc(ev.evento)}</span></span></li>`).join('')
      : '<li class="muted">—</li>');
    set('servicios', f.servicios_afectados.length
      ? f.servicios_afectados.map((s) =>
        `<li class="pieza-row mini"><span class="pieza-badge ${s.confirmado ? 'ok' : 'pend'}">${s.confirmado ? '✓' : '⏳'}</span>` +
        `<span class="pieza-info"><strong>${esc(s.nombre ?? s.id)}</strong><code>${esc(s.id)}</code></span>` +
        (s.afectados != null ? `<span class="pieza-qty">${s.afectados} afectados</span>` : '') + '</li>').join('')
      : '<li class="muted">—</li>');
    set('items', f.action_items.length
      ? f.action_items.map((it) => `<li class="pieza-row mini"><span class="pieza-info"><span style="font-size:0.88rem">${esc(it)}</span></span></li>`).join('')
      : '<li class="muted">—</li>');
    const sev = f.severidad;
    set('severidad', sev
      ? `<span class="chip ${SEVERIDAD_CLASE[sev] ?? 'chip-wip'}">${esc(sev)}</span>`
      : '—');
  } else {
    const orden = state.ordenes.find((o) => o.id === f.order_id) ?? null;
    const set = (k, html) => {
      const el = document.querySelector(`#screen-end [data-s="${k}"]`);
      if (el) el.innerHTML = html;
    };
    set('orden', esc(f.order_id ?? '—'));
    set('cliente', esc(orden?.cliente ?? '—'));
    set('equipo', esc(orden?.equipo ?? '—'));
    set('problema', esc(f.problema) || '—');
    set('diagnostico', esc(f.diagnostico) || '—');
    set('solucion', esc(f.solucion) || '—');
    set('piezas', f.piezas.length
      ? f.piezas.map((p) =>
        `<li class="pieza-row mini"><span class="pieza-badge ${p.confirmada ? 'ok' : 'pend'}">${p.confirmada ? '✓' : '⏳'}</span>` +
        `<span class="pieza-info"><strong>${esc(p.nombre)}</strong><code>${esc(p.sku)}</code></span>` +
        `<span class="pieza-qty">× ${p.qty}</span></li>`).join('')
      : '<li class="muted">—</li>');
    set('tiempo_minutos', f.tiempo_minutos != null ? `${f.tiempo_minutos} min` : '—');
    set('notas', esc(f.notas) || '—');
  }

  const evs = artifact.events;
  const nUser = artifact.transcript.filter((t) => t.role === 'user').length;
  const lastT = evs.length ? evs[evs.length - 1].t_ms : 0;
  $('end-stats').textContent =
    `${nUser} turnos del ${incidente ? 'operador' : 'técnico'} · ${evs.filter((e) => e.type === 'tool_call').length} tools · ` +
    `${evs.filter((e) => e.type === 'confirm_request').length} read-backs · ` +
    `${evs.filter((e) => e.type === 'barge_in').length} barge-ins · duración ${fmtMs(lastT)}`;

  show('screen-end');
}

/**
 * Export defensivo: el panel vive en export.js (se integra en paralelo).
 * Si el módulo falta o truena, la UI sigue viva: estado "export no
 * disponible" y descarga directa del JSON desde aquí (fallback propio).
 */
async function wireExportPanel(statusEl) {
  let wired = false;
  try {
    const mod = await import('./export.js');
    if (typeof mod?.initExportPanel === 'function') {
      await mod.initExportPanel({ artifact: state.artifact, statusEl });
      state.exportPanelNative = true;
      wired = true;
    } else {
      console.warn('[app] export.js no expone initExportPanel');
    }
  } catch (err) {
    console.warn('[app] export.js no disponible:', err?.message ?? err);
  }
  if (!wired) {
    wireExportFallback();
    statusEl.textContent = 'export no disponible — el artefacto JSON sí puede descargarse directo.';
  }
}

function wireExportFallback() {
  if (state.exportFallbackWired) return;
  state.exportFallbackWired = true;
  $('btn-download-artifact').addEventListener('click', () => {
    if (state.exportPanelNative) return;
    if (state.artifact) downloadArtifactJson(state.artifact);
  });
  for (const id of ['btn-export-csv', 'btn-export-pdf', 'btn-send-fsm']) {
    $(id).addEventListener('click', () => {
      if (state.exportPanelNative) return;
      $('export-status').textContent = 'export no disponible (falta el módulo export.js).';
    });
  }
}

function downloadArtifactJson(artifact) {
  try {
    const blob = new Blob([JSON.stringify(artifact, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${artifact.session_id}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    $('export-status').textContent = `Artefacto ${artifact.session_id}.json descargado.`;
  } catch { /* descargas bloqueadas */ }
}

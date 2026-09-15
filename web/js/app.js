/**
 * app.js — orquestador de UI (browser only). ESM, sin dependencias.
 *
 * Tres pantallas: consentimiento → orden+guion → sesión. Alimenta el DOM desde
 * los eventos del canal/mock/real y del session-engine; el artefacto §6 se
 * descarga y se POSTea a /api/sessions al cerrar.
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
import { AGENT_CONFIG } from './agent-config.js';
import { speakNombre, speakQty } from './dialog-act.js';

const $ = (id) => document.getElementById(id);
const state = {
  mode: 'mock', token: null, ordenes: [], piezas: [], guiones: [],
  orderId: null, guion: null, gt: null,
  channel: null, engine: null, store: null,
  timerHandle: null, agentBubbleEl: null, ended: false,
};

/* ================================================================== */
/* Boot                                                               */
/* ================================================================== */

async function boot() {
  wireConsent();
  await Promise.all([loadToken(), loadOrdenes(), loadPiezas(), loadGuiones()]);
  renderOrders();
  renderScenarios();
  wireSetup();
  wireSessionControls();
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

/* ---------------------------- pantallas ---------------------------- */

function show(screenId) {
  for (const s of document.querySelectorAll('.screen')) s.hidden = s.id !== screenId;
}

function wireConsent() {
  $('btn-consent').addEventListener('click', () => show('screen-setup'));
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

function renderOrders() {
  const ul = $('order-list');
  ul.textContent = '';
  if (!state.ordenes.length) {
    ul.insertAdjacentHTML('beforeend', '<li class="muted">Sin /data/ordenes.json — sirve el repo con un server estático.</li>');
    return;
  }
  for (const o of state.ordenes) {
    const li = document.createElement('li');
    const b = document.createElement('button');
    b.type = 'button';
    b.innerHTML = `<strong>${o.id}</strong> · ${o.cliente}<small>${o.equipo} — ${o.problema_reportado}</small>`;
    b.setAttribute('aria-pressed', 'false');
    b.addEventListener('click', () => {
      state.orderId = o.id;
      for (const btn of ul.querySelectorAll('button')) btn.setAttribute('aria-pressed', 'false');
      b.setAttribute('aria-pressed', 'true');
      refreshStartBtn();
    });
    li.append(b); ul.append(li);
  }
}

function renderScenarios() {
  const ul = $('scenario-list');
  ul.textContent = '';
  if (!state.guiones.length) {
    ul.insertAdjacentHTML('beforeend', '<li class="muted">Sin guiones en /data/guiones/.</li>');
    return;
  }
  for (const g of state.guiones) {
    const li = document.createElement('li');
    const b = document.createElement('button');
    b.type = 'button';
    b.innerHTML = `<strong>${g.scenario_id}</strong> · ${g.order_id}<small>${(g.description ?? '').slice(0, 90)}…</small>`;
    b.setAttribute('aria-pressed', 'false');
    b.addEventListener('click', () => {
      state.guion = g;
      for (const btn of ul.querySelectorAll('button')) btn.setAttribute('aria-pressed', 'false');
      b.setAttribute('aria-pressed', 'true');
      const d = $('scenario-desc');
      d.textContent = g.description ?? ''; d.hidden = !g.description;
      refreshStartBtn();
    });
    li.append(b); ul.append(li);
  }
}

function refreshStartBtn() {
  const guionMatchesOrder = !state.guion || !state.orderId || state.guion.order_id === state.orderId;
  const err = $('setup-error');
  if (state.orderId && state.guion && !guionMatchesOrder) {
    err.textContent = `El guion ${state.guion.scenario_id} va con la orden ${state.guion.order_id}; elige esa.`;
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

async function startSession() {
  show('screen-session');
  $('session-status').hidden = true;
  state.ended = false;
  const guion = prepareGuion(state.guion, state.gt?.[state.guion.scenario_id] ?? null);

  const tools = buildToolDefinitions(state.piezas.map((p) => p.sku));

  let channel;
  if (state.mode === 'real' && state.token) {
    channel = createRealAgentChannel({ token: state.token, tools });
  } else {
    channel = createMockAgentChannel({
      ordenes: state.ordenes, piezas: state.piezas, guion, speed: 1,
    });
  }
  const clock = channel.clock;
  state.channel = channel;
  state.store = createStore({ orderId: state.guion.order_id ?? state.orderId, now: () => clock.now() });
  const runner = createToolRunner({ ordenes: state.ordenes, piezas: state.piezas, store: state.store, clock });
  state.engine = createSessionEngine({
    channel, toolRunner: runner, store: state.store,
    meta: {
      session_id: `sess_${new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 15)}`,
      scenario_id: state.guion.scenario_id, mode: state.mode,
      order_id: state.guion.order_id ?? state.orderId,
      noise_condition: state.guion.noise_condition ?? 'clean',
    },
    clock,
    onEvent: (type) => {
      if (['tool_result', 'confirm_result', 'form_update', 'report_sent'].includes(type)) renderForm();
    },
  });

  wireSessionUi(channel, state.engine);
  renderForm();
  state.engine.start();
  startCronometro();

  try {
    await channel.start();
  } catch (err) {
    setStatus(`Error al iniciar el canal: ${err?.message ?? err}`, true);
  }
}

function wireSessionUi(channel, engine) {
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

  channel.on('user_turn_start', () => { state.agentBubbleEl = null; });
  channel.on('user_turn_end', (d) => appendBubble('user', d.text));
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
  channel.on('confirm_request', (d) => showReadbackBanner(d.value));
  channel.on('confirm_result', (d) => {
    if (d.confirmed) hideReadbackBanner();
    else showReadbackBanner(d.value, 'Rechazada por el técnico — corrigiendo…');
  });
  channel.on('report_sent', () => {
    hideReadbackBanner();
    setStatus('Reporte enviado. Puedes terminar la sesión y descargar el artefacto.');
  });
  channel.on('error', (d) => setStatus(`Error de sesión: ${d.code} — ${d.message}`, true));
  channel.on('ended', () => { if (!state.ended) finishSession(); });
  void engine;
}

function showReadbackBanner(value, label) {
  const b = $('readback-banner');
  const t = $('readback-text');
  b.hidden = false;
  b.classList.add('pendiente');
  t.textContent = label ?? `${speakNombre(value?.nombre)} × ${value?.qty} — responde sí / no`;
}
function hideReadbackBanner() {
  $('readback-banner').hidden = true;
  $('readback-banner').classList.remove('pendiente');
}

function renderForm() {
  const f = state.store?.final_form;
  if (!f) return;
  const set = (field, html) => {
    const dd = document.querySelector(`#ficha [data-field="${field}"] dd`);
    if (dd) dd.innerHTML = html;
  };
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  set('order_id', esc(f.order_id) || '—');
  set('problema', esc(f.problema) || '—');
  set('diagnostico', esc(f.diagnostico) || '—');
  set('solucion', esc(f.solucion) || '—');
  set('piezas', f.piezas.length
    ? f.piezas.map((p) =>
      `<div><span class="pieza-${p.confirmada ? 'ok' : 'pend'}">${p.confirmada ? '✔' : '…'}</span> ` +
      `${esc(p.nombre)} × ${p.qty} <span class="sku">${esc(p.sku)}</span></div>`).join('')
    : '—');
  set('tiempo_minutos', f.tiempo_minutos != null ? `${f.tiempo_minutos} min` : '—');
  set('notas', esc(f.notas) || '—');
  set('estado', `<span class="${f.estado === 'enviada' ? 'estado-enviada' : ''}">${esc(f.estado)}</span>`);

  const trail = $('audit-trail');
  trail.textContent = '';
  for (const a of [...(state.store?.audit ?? [])].slice(-40).reverse()) {
    const li = document.createElement('li');
    const t = a.t_ms != null ? `${(a.t_ms / 1000).toFixed(1)}s` : '';
    li.innerHTML = `<code>${t}</code> ${esc(a.action)} ${a.changed ? `<code>[${a.changed.join(',')}]</code>` : ''} ${a.sku ? esc(a.sku) : ''}`;
    trail.append(li);
  }
}

function startCronometro() {
  stopCronometro();
  const tick = () => {
    if (!state.store || !state.channel) return;
    const now = state.channel.clock.now();
    const start = state.store.workStartedAt ?? now;
    const min = Math.max(0, Math.round((now - start) / 60000));
    $('cronometro').textContent = `${min} min`;
  };
  state.timerHandle = setInterval(tick, 1000);
}
function stopCronometro() { if (state.timerHandle) clearInterval(state.timerHandle); }

function setStatus(msg, isError = false) {
  const el = $('session-status');
  el.textContent = msg;
  el.style.color = isError ? 'var(--danger)' : '';
  el.hidden = false;
}

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
}

async function finishSession() {
  if (state.ended) return;
  state.ended = true;
  stopCronometro();
  hideReadbackBanner();
  try { await state.channel?.stop?.(); } catch { /* canal ya muerto */ }
  const artifact = state.engine?.end();
  if (!artifact) return;
  renderForm();

  // 1) descarga local del artefacto
  try {
    const blob = new Blob([JSON.stringify(artifact, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${artifact.session_id}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  } catch { /* descargas bloqueadas */ }

  // 2) persistencia server-side (texto, jamás audio)
  let posted = false;
  try {
    const r = await fetch('/api/sessions', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify(artifact),
    });
    posted = r.ok;
  } catch { /* sin backend */ }
  setStatus(
    `Sesión cerrada. Turnos: ${artifact.transcript.length}, eventos: ${artifact.events.length}. ` +
    `Artefacto descargado${posted ? ' y enviado a /api/sessions' : ' (POST a /api/sessions no disponible)'}. ` +
    'Métricas: corre `node metrics/cli.js` sobre el JSON (CLI-side).',
  );
}

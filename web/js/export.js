// export.js — panel de exportación del cierre de sesión (CSV / PDF / artefacto / FSM).
//
// Contrato con app.js (pantalla de cierre):
//   initExportPanel({ artifact, statusEl })
//     artifact : artefacto completo §6 (docs/architecture.md) — se lee EN CADA
//                acción, así que re-llamar init con un artefacto nuevo basta.
//     statusEl : HTMLElement donde se agregan líneas de estado legibles (ES).
//   Cablea los 4 botones del cierre: #btn-export-csv, #btn-export-pdf,
//   #btn-download-artifact, #btn-send-fsm. Si un botón todavía no existe en el
//   DOM, un listener delegado en document (fase captura) lo cablea en el
//   primer click — el click en curso sí dispara la acción porque la propagación
//   aún no llega al botón cuando se agrega el listener. Nunca se cablea dos
//   veces el mismo nodo (bandera data-fsvl-export-wired).
//
// La parte superior del módulo (builders de CSV/Markdown de la orden) es
// deliberadamente SIN DOM: scripts/export.mjs (CLI de métricas/CI) importa estos
// builders para producir exactamente el mismo CSV que descarga el navegador.

// ---------------------------------------------------------------------------
// Builders puros (sin DOM — importables desde Node)
// ---------------------------------------------------------------------------

// Bloque 1 del CSV: columnas de la ficha (cliente se rellena desde final_form
// o desde el último get_orden registrado en events).
const FICHA_COLUMNS = [
  'order_id', 'cliente', 'problema', 'diagnostico', 'solucion',
  'tiempo_minutos', 'notas', 'estado',
];
// Bloque 2 del CSV: columnas del detalle de piezas.
const PIEZA_COLUMNS = ['sku', 'nombre', 'qty', 'confirmada'];

/** Celda RFC 4180: siempre entrecomillada, comillas escapadas como "". */
function csvCell(value) {
  const s = value === null || value === undefined ? '' : String(value);
  return `"${s.replaceAll('"', '""')}"`;
}

function csvRow(cells) {
  return cells.map(csvCell).join(',');
}

/**
 * Datos de la orden (cliente/sitio/equipo/técnico): primero final_form (si el
 * schema los trae), luego el último tool_result de get_orden en events[].
 * Devuelve '' en lo que no encuentre.
 */
export function ordenInfoDe(artifact) {
  const info = { cliente: '', sitio: '', equipo: '', tecnico: '' };
  const ff = artifact && artifact.final_form;
  if (ff && typeof ff === 'object' && !Array.isArray(ff)) {
    for (const k of Object.keys(info)) {
      if (typeof ff[k] === 'string' && ff[k]) info[k] = ff[k];
    }
  }
  const events = Array.isArray(artifact && artifact.events) ? artifact.events : [];
  for (let i = events.length - 1; i >= 0; i--) {
    const ev = events[i] || {};
    const orden = ev.result && ev.result.orden;
    if (ev.type === 'tool_result' && orden && typeof orden === 'object') {
      for (const k of Object.keys(info)) {
        if (!info[k] && typeof orden[k] === 'string' && orden[k]) info[k] = orden[k];
      }
      break; // el último get_orden manda
    }
  }
  return info;
}

/** Campos escalares extra de final_form que no están en FICHA_COLUMNS. */
function extraFichaFields(ff) {
  const known = new Set(FICHA_COLUMNS);
  const extras = [];
  if (ff && typeof ff === 'object' && !Array.isArray(ff)) {
    for (const [k, v] of Object.entries(ff)) {
      if (known.has(k) || k === 'piezas') continue;
      if (v === null || v === undefined || ['string', 'number', 'boolean'].includes(typeof v)) {
        extras.push([k, v === null || v === undefined ? '' : v]);
      }
    }
  }
  return extras;
}

/**
 * CSV de dos bloques (formato documentado en web/README.md):
 *   1) una fila de encabezado + UNA fila de valores con los campos de la ficha;
 *   2) línea vacía, encabezado de piezas y una fila por pieza.
 * Siempre BOM UTF-8 (Excel) y finales de línea CRLF, salvo opts.bom === false.
 */
export function buildOrdenCsv(artifact, opts) {
  const ff = (artifact && artifact.final_form) || {};
  const extras = extraFichaFields(ff);
  const columns = FICHA_COLUMNS.concat(extras.map(([k]) => k));
  const info = ordenInfoDe(artifact);

  const values = columns.map((col) => {
    if (col === 'cliente') return info.cliente;
    if (Object.prototype.hasOwnProperty.call(ff, col)) {
      const v = ff[col];
      return v === null || v === undefined ? '' : v;
    }
    return '';
  });

  const piezas = Array.isArray(ff.piezas) ? ff.piezas : [];
  const lines = [csvRow(columns), csvRow(values), '', csvRow(PIEZA_COLUMNS)];
  for (const p of piezas) {
    lines.push(csvRow(PIEZA_COLUMNS.map((c) => (p && typeof p === 'object' ? p[c] : ''))));
  }

  const bom = !opts || opts.bom !== false ? '\uFEFF' : '';
  return bom + lines.join('\r\n') + '\r\n';
}

/** yyyyMMdd-HHmm (hora local) para nombres de archivo; cae a "ahora" si date es inválido. */
export function stampForFilename(date) {
  const d = date instanceof Date ? date : new Date(date);
  if (isNaN(d.getTime())) d.setTime(Date.now());
  const p = (n, w) => String(n).padStart(w || 2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

/** Deja un token seguro para nombre de archivo. */
export function sanitizeFileToken(value) {
  const s = String(value || '').replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  return s || 'orden';
}

/** orden-<id>-<yyyymmdd-hhmm>.csv */
export function ordenFilename(orderId, date) {
  return `orden-${sanitizeFileToken(orderId)}-${stampForFilename(date)}.csv`;
}

/** Celda de tabla markdown: sin pipes ni saltos que rompan la tabla. */
function mdCell(value) {
  const s = value === null || value === undefined ? '' : String(value);
  return s.replaceAll('|', '\\|').replaceAll('\r', ' ').replaceAll('\n', ' ').trim() || '—';
}

/** Versión humana (markdown) de la orden cerrada, con nota de auditoría de voz. */
export function buildOrdenMarkdown(artifact, opts) {
  const a = artifact || {};
  const ff = a.final_form || {};
  const info = ordenInfoDe(a);
  const id = ff.order_id || a.order_id || '(sin id)';
  const piezas = Array.isArray(ff.piezas) ? ff.piezas : [];
  const cuando = opts && opts.generatedAt ? opts.generatedAt : new Date().toISOString();

  const out = [];
  out.push(`# Orden de trabajo ${id}`, '');
  if (info.cliente) out.push(`**Cliente:** ${mdCell(info.cliente)}`, '');
  if (info.sitio) out.push(`**Sitio:** ${mdCell(info.sitio)}`, '');
  if (info.equipo) out.push(`**Equipo:** ${mdCell(info.equipo)}`, '');
  if (info.tecnico) out.push(`**Técnico:** ${mdCell(info.tecnico)}`, '');
  out.push(`**Estado:** ${mdCell(ff.estado)} · **Tiempo de trabajo:** ${
    ff.tiempo_minutos === null || ff.tiempo_minutos === undefined ? '—' : `${ff.tiempo_minutos} min`
  }`, '');

  out.push('## Problema', '', mdCell(ff.problema), '');
  out.push('## Diagnóstico', '', mdCell(ff.diagnostico), '');
  out.push('## Solución', '', mdCell(ff.solucion), '');

  out.push('## Piezas', '');
  if (piezas.length === 0) {
    out.push('(sin piezas registradas)', '');
  } else {
    out.push('| SKU | Pieza | Cant. | Confirmada |', '|---|---|---:|---|');
    for (const p of piezas) {
      const q = p && typeof p === 'object' ? p : {};
      out.push(`| ${mdCell(q.sku)} | ${mdCell(q.nombre)} | ${mdCell(q.qty)} | ${q.confirmada ? 'Sí' : 'No'} |`);
    }
    out.push('');
  }

  if (ff.notas) out.push('## Notas', '', mdCell(ff.notas), '');

  out.push('---', '',
    '*Documento generado por sesión de voz — el audio no fue retenido.*', '',
    `Sesión \`${a.session_id || 'sin-id'}\` · escenario \`${a.scenario_id || '-'}\` · exportado ${cuando}`, '');
  return out.join('\n');
}

// ---------------------------------------------------------------------------
// Panel DOM (solo se ejecuta en navegador)
// ---------------------------------------------------------------------------

const state = { artifact: null, statusEl: null, delegated: false };
const WIRE_FLAG = 'data-fsvl-export-wired';
const MAX_STATUS_LINES = 8;

function errMsg(err) {
  return (err && err.message) ? err.message : String(err);
}

/** Agrega una línea de estado en español; recorta a las últimas N. */
function line(kind, text) {
  const el = state.statusEl;
  if (!el || typeof document === 'undefined') {
    console[kind === 'err' ? 'error' : 'log'](`[export] ${text}`);
    return;
  }
  const div = document.createElement('div');
  div.className = 'export-status-line';
  div.dataset.kind = kind;
  div.textContent = text;
  el.appendChild(div);
  while (el.children.length > MAX_STATUS_LINES) el.removeChild(el.firstChild);
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

/** Inyecta (una sola vez) la hoja de impresión de la ficha. */
function ensurePrintStylesheet() {
  if (typeof document === 'undefined' || document.getElementById('fsvl-print-css')) return;
  const link = document.createElement('link');
  link.id = 'fsvl-print-css';
  link.rel = 'stylesheet';
  link.href = 'css/print.css';
  document.head.appendChild(link);
}

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
}

/** Construye (o vacía y reconstruye) el #print-view con la ficha de la orden. */
function buildPrintView() {
  let pv = document.getElementById('print-view');
  if (!pv) {
    pv = document.createElement('section');
    pv.id = 'print-view';
    document.body.appendChild(pv);
  }
  pv.replaceChildren();

  const a = state.artifact || {};
  const ff = a.final_form || {};
  const info = ordenInfoDe(a);
  const id = ff.order_id || a.order_id || '(sin id)';

  const head = el('header', 'pv-head');
  head.appendChild(el('h1', null, `Orden de trabajo ${id}`));
  if (info.cliente) head.appendChild(el('p', 'pv-sub', info.cliente));
  pv.appendChild(head);

  const dl = el('dl', 'pv-meta');
  const metaRows = [
    ['Sitio', info.sitio],
    ['Equipo', info.equipo],
    ['Técnico', info.tecnico],
    ['Estado', ff.estado],
    ['Tiempo de trabajo', ff.tiempo_minutos === null || ff.tiempo_minutos === undefined ? '' : `${ff.tiempo_minutos} min`],
  ];
  for (const [k, v] of metaRows) {
    if (!v) continue;
    dl.appendChild(el('dt', null, `${k}:`));
    dl.appendChild(el('dd', null, String(v)));
  }
  if (dl.childNodes.length > 0) pv.appendChild(dl);

  const seccion = (titulo, texto) => {
    const s = el('section', 'pv-sec');
    s.appendChild(el('h2', null, titulo));
    s.appendChild(el('p', 'pv-text', texto && String(texto).trim() ? String(texto) : '—'));
    pv.appendChild(s);
  };
  seccion('Problema', ff.problema);
  seccion('Diagnóstico', ff.diagnostico);
  seccion('Solución', ff.solucion);

  const secPiezas = el('section', 'pv-sec');
  secPiezas.appendChild(el('h2', null, 'Piezas'));
  const piezas = Array.isArray(ff.piezas) ? ff.piezas : [];
  if (piezas.length === 0) {
    secPiezas.appendChild(el('p', 'pv-text', '(sin piezas registradas)'));
  } else {
    const tbl = el('table', 'pv-piezas');
    const thead = el('thead');
    const hr = el('tr');
    for (const h of ['SKU', 'Pieza', 'Cant.', 'Confirmada']) hr.appendChild(el('th', null, h));
    thead.appendChild(hr);
    tbl.appendChild(thead);
    const tbody = el('tbody');
    for (const p of piezas) {
      const q = p && typeof p === 'object' ? p : {};
      const tr = el('tr');
      const tdSku = el('td', 'pv-sku', String(q.sku ?? ''));
      tr.appendChild(tdSku);
      tr.appendChild(el('td', null, String(q.nombre ?? '')));
      tr.appendChild(el('td', 'pv-qty', String(q.qty ?? '')));
      tr.appendChild(el('td', null, q.confirmada ? 'Sí' : 'No'));
      tbody.appendChild(tr);
    }
    tbl.appendChild(tbody);
    secPiezas.appendChild(tbl);
  }
  pv.appendChild(secPiezas);

  if (ff.notas && String(ff.notas).trim()) seccion('Notas', ff.notas);

  const foot = el('footer', 'pv-foot');
  foot.appendChild(el('p', 'pv-audit', 'Documento generado por sesión de voz — el audio no fue retenido.'));
  foot.appendChild(el('p', 'pv-audit', `Sesión ${a.session_id || 'sin-id'} · impreso ${new Date().toLocaleString('es-MX')}`));
  pv.appendChild(foot);
  return pv;
}

// --- acciones (todas con try/catch vía guarded) ------------------------------

function doExportCsv() {
  const a = state.artifact || {};
  const ff = a.final_form || {};
  const id = ff.order_id || a.order_id;
  if (!ff || Array.isArray(ff) || Object.keys(ff).length === 0) {
    line('err', 'No hay ficha final en el artefacto; no puedo armar el CSV.');
    return;
  }
  const name = ordenFilename(id, new Date());
  const csv = buildOrdenCsv(a);
  downloadBlob(new Blob([csv], { type: 'text/csv;charset=utf-8' }), name);
  line('ok', `CSV descargado (${(Array.isArray(ff.piezas) ? ff.piezas.length : 0)} piezas): ${name}`);
}

function doExportPdf() {
  ensurePrintStylesheet();
  buildPrintView();
  line('info', 'Abriendo diálogo de impresión: elige «Guardar como PDF» para exportar la ficha.');
  requestAnimationFrame(() => window.print());
}

function doDownloadArtifact() {
  const a = state.artifact;
  if (!a) {
    line('err', 'No hay artefacto para descargar.');
    return;
  }
  const id = a.session_id || (a.final_form && a.final_form.order_id) || 'sesion';
  const name = `artefacto-${sanitizeFileToken(id)}-${stampForFilename(new Date())}.json`;
  const json = JSON.stringify(a, null, 2);
  downloadBlob(new Blob([json], { type: 'application/json' }), name);
  line('ok', `Artefacto JSON descargado: ${name}`);
}

async function doSendFsm() {
  const a = state.artifact || {};
  const ff = a.final_form || {};
  const orderId = ff.order_id || a.order_id;
  if (!orderId) {
    line('err', 'No puedo enviar al FSM: el artefacto no trae order_id.');
    return;
  }
  const payload = {
    order_id: orderId,
    final_form: ff,
    session_id: a.session_id || '',
    sent_at: new Date().toISOString(),
  };
  if (!payload.session_id) {
    line('err', 'No puedo enviar al FSM: el artefacto no trae session_id.');
    return;
  }
  line('info', `Enviando orden ${orderId} al FSM…`);
  let res;
  try {
    res = await fetch('/api/fsm/report', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch {
    line('err', 'Sin conexión con el FSM (¿corre el server? en mock: npm run dev). Reintenta con el mismo botón.');
    return;
  }
  let j = null;
  try { j = await res.json(); } catch { /* respuesta no-JSON */ }
  if (res.ok && j && j.ok && j.accepted) {
    line('ok', `FSM aceptó el reporte: ack ${j.fsm_id} (recibido ${j.received_at}).`);
  } else {
    const detalle = j && j.message ? `: ${j.message}` : '';
    line('err', `El FSM rechazó el envío (HTTP ${res.status}${detalle}).`);
  }
}

// --- cableado de botones (con reintento si aún no existen) --------------------

const ACTIONS = {
  'btn-export-csv': doExportCsv,
  'btn-export-pdf': doExportPdf,
  'btn-download-artifact': doDownloadArtifact,
  'btn-send-fsm': doSendFsm,
};

function guardado(label, fn) {
  return () => {
    try {
      Promise.resolve(fn()).catch((err) => line('err', `${label} — error: ${errMsg(err)}`));
    } catch (err) {
      line('err', `${label} — error: ${errMsg(err)}`);
    }
  };
}

const GUARDED = {};
for (const [id, fn] of Object.entries(ACTIONS)) GUARDED[id] = guardado(id, fn);

function wireButtons() {
  for (const [id, fn] of Object.entries(GUARDED)) {
    const btn = document.getElementById(id);
    if (btn && !btn.hasAttribute(WIRE_FLAG)) {
      btn.setAttribute(WIRE_FLAG, '1');
      btn.addEventListener('click', fn);
    }
  }
}

/** Reintento de cableo: si un botón aparece tarde (o se re-renderiza), el
 *  primer click lo cablea y ese mismo click sí ejecuta la acción. */
function wireDelegated() {
  if (state.delegated) return;
  state.delegated = true;
  document.addEventListener('click', (ev) => {
    const target = ev.target;
    if (!(target instanceof Element)) return;
    for (const id of Object.keys(GUARDED)) {
      const btn = target.closest(`#${id}`);
      if (btn && !btn.hasAttribute(WIRE_FLAG)) {
        btn.setAttribute(WIRE_FLAG, '1');
        btn.addEventListener('click', GUARDED[id]);
      }
    }
  }, true);
}

/**
 * Inicializa el panel de exportación del cierre de sesión.
 * Llamar de nuevo (p. ej. en otra sesión) actualiza el artefacto activo.
 */
export function initExportPanel({ artifact, statusEl } = {}) {
  if (artifact) state.artifact = artifact;
  if (typeof HTMLElement !== 'undefined' && statusEl instanceof HTMLElement) {
    state.statusEl = statusEl;
  }
  ensurePrintStylesheet();
  wireButtons();
  wireDelegated();
  line('info', 'Exportación lista: CSV, PDF (impresión), artefacto JSON y envío a FSM.');
  return {
    update(nextArtifact) { if (nextArtifact) state.artifact = nextArtifact; },
  };
}

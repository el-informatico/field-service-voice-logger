// POST /api/fsm/report — conector FSM (field service management) SIMULADO.
// GET  /api/fsm/report — lista de acks enviados (solo metadatos).
//
// Recibe el cierre {order_id, final_form, session_id, sent_at?} del navegador
// y responde un ack {ok:true, accepted:true, fsm_id:"FSM-<yyyymmdd>-<rand6>",
// received_at}. El ack se persiste como JSON bajo FSM_DIR (default `.data/fsm`
// local, `/tmp/fsvl-fsm` en Vercel — disco efímero, documentado en
// api/README.md). Para el conector real: reemplazar storeReport() por la
// llamada a la API del FSM del cliente (decisión D5, mismo patrón que
// api/sessions.js#storeArtifact).
//
// Mismos invariantes que api/sessions.js:
//   - same-origin únicamente, respuestas no-store, cero CORS;
//   - `audio_retained`, si viene en el body, debe ser exactamente false —
//     cualquier otra cosa se rechaza con 400;
//   - cualquier string > 64 KB se rechaza (guardia anti-contrabando de audio:
//     aquí solo viaja la ficha, nunca audio);
//   - body <= 1 MB.

import { randomBytes } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import {
  sendJson,
  sendError,
  readJsonBody,
  isSameOrigin,
  sendNoContentOptions,
  HttpError,
} from './_lib/http.js';

const MAX_BODY_BYTES = 1024 * 1024; // 1 MB: la ficha cerrada es mucho menor
const MAX_STRING_BYTES = 64 * 1024; // strings mayores huelen a audio embebido
const ORDER_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const SESSION_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const FSM_ID_RE = /^FSM-[0-9]{8}-[A-Za-z0-9]{6}$/;

const EPHEMERAL_NOTE =
  'Filesystem storage only: on Vercel serverless the disk is ephemeral (/tmp, recycled at any time), so this FSM ack is NOT durable. For the real connector plug the FSM API call into storeReport() in api/fsm.js (see api/README.md, decision D5).';

function fsmDir() {
  if (process.env.FSM_DIR && process.env.FSM_DIR.trim()) return process.env.FSM_DIR;
  if (process.env.VERCEL || process.env.VERCEL_ENV) return '/tmp/fsvl-fsm';
  return path.resolve(process.cwd(), '.data/fsm');
}

/** FSM-<yyyymmdd UTC>-<rand6 hex> — id del ack del lado del "FSM". */
function newFsmId(receivedAt) {
  const yyyymmdd = receivedAt.slice(0, 10).replaceAll('-', '');
  return `FSM-${yyyymmdd}-${randomBytes(3).toString('hex')}`;
}

/** Iterative deep scan: true if ANY string value (or object key) is oversized. */
function hasOversizedString(value) {
  const stack = [value];
  while (stack.length > 0) {
    const node = stack.pop();
    if (typeof node === 'string') {
      if (Buffer.byteLength(node, 'utf8') > MAX_STRING_BYTES) return true;
    } else if (Array.isArray(node)) {
      for (const item of node) stack.push(item);
    } else if (node !== null && typeof node === 'object') {
      for (const [k, v] of Object.entries(node)) {
        if (k.length > 512) return true; // pathological keys, same spirit
        stack.push(v);
      }
    }
  }
  return false;
}

/** Returns null when the report is valid, else a human-readable problem. */
function validateReport(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return 'Body must be a JSON object: {order_id, final_form, session_id, sent_at?}.';
  }
  if (typeof body.order_id !== 'string' || !ORDER_ID_RE.test(body.order_id)) {
    return '`order_id` must be a string matching [A-Za-z0-9_-]{1,64} (e.g. OT-1042).';
  }
  if (!body.final_form || typeof body.final_form !== 'object' || Array.isArray(body.final_form)) {
    return '`final_form` must be an object (the closed work-order form, docs/architecture.md §6).';
  }
  if (typeof body.session_id !== 'string' || !SESSION_ID_RE.test(body.session_id)) {
    return '`session_id` must be a string matching [A-Za-z0-9_-]{1,64}.';
  }
  if (body.sent_at !== undefined && body.sent_at !== null &&
      (typeof body.sent_at !== 'string' || body.sent_at.length > 64)) {
    return '`sent_at`, when present, must be a short ISO-8601 string.';
  }
  if (body.audio_retained !== undefined && body.audio_retained !== false) {
    return '`audio_retained` must be exactly false — the FSM connector refuses reports that claim retained audio (privacy invariant, architecture.md §3).';
  }
  if (hasOversizedString(body)) {
    return 'audio-like payload refused: string fields over 64 KB are rejected — send the final form only, never audio.';
  }
  return null;
}

async function storeReport(req, res) {
  if (!isSameOrigin(req)) {
    return sendJson(res, 403, { ok: false, error: 'cross_origin_refused', message: 'FSM reports are accepted same-origin only.' });
  }
  const body = await readJsonBody(req, MAX_BODY_BYTES);
  const problem = validateReport(body);
  if (problem) throw new HttpError(400, 'invalid_report', problem);

  const received_at = new Date().toISOString();
  const fsm_id = newFsmId(received_at);
  const ack = {
    ok: true,
    accepted: true,
    fsm_id,
    order_id: body.order_id,
    session_id: body.session_id,
    sent_at: typeof body.sent_at === 'string' ? body.sent_at : null,
    received_at,
    final_form: body.final_form,
  };

  const dir = fsmDir();
  let stored = true;
  let note = EPHEMERAL_NOTE;
  try {
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, `${fsm_id}.json`), `${JSON.stringify(ack, null, 2)}\n`, 'utf8');
  } catch (err) {
    stored = false;
    note = `${EPHEMERAL_NOTE} (Also: the write failed on this host — ${err.code || err.message} — the report validated but the ack was NOT persisted.)`;
    console.error('[api/fsm] ack write failed:', err.message);
  }
  return sendJson(res, 200, { ok: true, accepted: true, fsm_id, order_id: body.order_id, received_at, stored, ephemeral_note: note });
}

function metadataOf(ack, fallbackId) {
  return {
    fsm_id: FSM_ID_RE.test(ack.fsm_id) ? ack.fsm_id : fallbackId,
    order_id: ack.order_id ?? null,
    session_id: ack.session_id ?? null,
    received_at: ack.received_at ?? null,
  };
}

async function listReports(req, res) {
  if (!isSameOrigin(req)) {
    return sendJson(res, 403, { ok: false, error: 'cross_origin_refused', message: 'FSM acks are readable same-origin only.' });
  }
  const dir = fsmDir();
  let files = [];
  try {
    files = (await readdir(dir)).filter((f) => f.endsWith('.json'));
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
  const reports = [];
  for (const f of files) {
    try {
      const ack = JSON.parse(await readFile(path.join(dir, f), 'utf8'));
      reports.push(metadataOf(ack, f.slice(0, -5)));
    } catch {
      /* skip partially-written or corrupt files */
    }
  }
  reports.sort((a, b) => String(b.received_at ?? '').localeCompare(String(a.received_at ?? '')));
  return sendJson(res, 200, { ok: true, count: reports.length, reports });
}

export default async function handler(req, res) {
  const method = (req.method || 'GET').toUpperCase();
  try {
    if (method === 'POST') return await storeReport(req, res);
    if (method === 'GET') return await listReports(req, res);
    if (method === 'OPTIONS') return sendNoContentOptions(res, 'GET, POST, OPTIONS');
    return sendJson(res, 405, { ok: false, error: 'method_not_allowed', message: 'Use GET or POST.' }, { allow: 'GET, POST, OPTIONS' });
  } catch (err) {
    return sendError(res, err, 'Failed to process the FSM report.');
  }
}

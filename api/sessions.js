// GET|POST /api/sessions — persist and read back session artifacts.
//
// PRIVACY INVARIANTS (architecture.md §3, §10) enforced HERE, not just promised:
//   - the artifact must carry `audio_retained === false` (strictly) — anything
//     else is rejected with 400: the server refuses to store a session that
//     claims retained audio;
//   - any string field over 64 KB is rejected with 400 "audio-like payload
//     refused" (base64 audio smuggling guard — only transcript, tool events
//     and final form belong here);
//   - bodies over 2 MB are rejected (413).
// Artifacts are written as pretty JSON under SESSIONS_DIR (default
// `.data/sessions` locally, `/tmp/...` on Vercel — the serverless FS is
// ephemeral and that is documented; responses carry an ephemeral_note).

import { randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import {
  NO_STORE,
  sendJson,
  sendError,
  getQuery,
  readJsonBody,
  isSameOrigin,
  sendNoContentOptions,
  HttpError,
} from './_lib/http.js';

const MAX_BODY_BYTES = 2 * 1024 * 1024; // 2 MB artifact cap
const MAX_STRING_BYTES = 64 * 1024; // strings bigger than this look like smuggled audio
const SESSION_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

const EPHEMERAL_NOTE =
  'Filesystem storage only: on Vercel serverless the disk is ephemeral (/tmp, recycled at any time), so this artifact is NOT durable. For persistence plug a real store into storeArtifact() in api/sessions.js (see api/README.md, decision D5).';

function sessionsDir() {
  if (process.env.SESSIONS_DIR && process.env.SESSIONS_DIR.trim()) return process.env.SESSIONS_DIR;
  if (process.env.VERCEL || process.env.VERCEL_ENV) return '/tmp/fsvl-sessions';
  return path.resolve(process.cwd(), '.data/sessions');
}

function newSessionId() {
  return `sess_${Date.now().toString(36)}_${randomUUID().replaceAll('-', '').slice(0, 10)}`;
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

/** Returns null when the artifact is valid, else a human-readable problem. */
function validateArtifact(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return 'Body must be a JSON object: the session artifact defined in docs/architecture.md §6.';
  }
  if (typeof body.schema_version !== 'number' || !Number.isFinite(body.schema_version)) {
    return '`schema_version` must be a number.';
  }
  if (!Array.isArray(body.events)) {
    return '`events` must be an array.';
  }
  if (!body.final_form || typeof body.final_form !== 'object' || Array.isArray(body.final_form)) {
    return '`final_form` must be an object.';
  }
  if (body.audio_retained !== false) {
    return '`audio_retained` must be exactly false — the server refuses to store a session that claims retained audio (privacy invariant, architecture.md §3).';
  }
  if (hasOversizedString(body)) {
    return 'audio-like payload refused: string fields over 64 KB are rejected — upload transcript/tool events/final form only, never audio.';
  }
  return null;
}

async function storeArtifact(req, res) {
  if (!isSameOrigin(req)) {
    return sendJson(res, 403, { ok: false, error: 'cross_origin_refused', message: 'Session artifacts are accepted same-origin only.' });
  }
  const body = await readJsonBody(req, MAX_BODY_BYTES);
  const problem = validateArtifact(body);
  if (problem) throw new HttpError(400, 'invalid_artifact', problem);

  // session_id: keep a valid one, generate otherwise (never trust for paths).
  let id = typeof body.session_id === 'string' ? body.session_id : '';
  if (!SESSION_ID_RE.test(id)) id = newSessionId();
  body.session_id = id; // stored artifact always carries a valid id

  const dir = sessionsDir();
  let stored = true;
  let note = EPHEMERAL_NOTE;
  try {
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, `${id}.json`), `${JSON.stringify(body, null, 2)}\n`, 'utf8');
  } catch (err) {
    stored = false;
    note = `${EPHEMERAL_NOTE} (Also: the write failed on this host — ${err.code || err.message} — the artifact validated but was NOT persisted.)`;
    console.error('[api/sessions] artifact write failed:', err.message);
  }
  return sendJson(res, 200, { ok: true, id, stored, ephemeral_note: note });
}

function metadataOf(artifact, fallbackId) {
  return {
    id: typeof artifact.session_id === 'string' ? artifact.session_id : fallbackId,
    order_id: artifact.order_id ?? null,
    started_at: artifact.started_at ?? null,
    ended_at: artifact.ended_at ?? null,
    scenario_id: artifact.scenario_id ?? null,
    mode: artifact.mode ?? null,
  };
}

async function readSessions(req, res) {
  if (!isSameOrigin(req)) {
    return sendJson(res, 403, { ok: false, error: 'cross_origin_refused', message: 'Session artifacts are readable same-origin only.' });
  }
  const { id } = getQuery(req);
  const dir = sessionsDir();

  if (id !== undefined) {
    if (typeof id !== 'string' || !SESSION_ID_RE.test(id)) {
      throw new HttpError(400, 'invalid_id', 'Query param `id` must match [A-Za-z0-9_-]{1,64}.');
    }
    let raw;
    try {
      raw = await readFile(path.join(dir, `${id}.json`), 'utf8');
    } catch (err) {
      if (err.code === 'ENOENT' || err.code === 'ENOTDIR') {
        throw new HttpError(404, 'not_found', `No stored session with id ${id}.`);
      }
      throw err;
    }
    try {
      return sendJson(res, 200, JSON.parse(raw));
    } catch {
      throw new HttpError(500, 'corrupt_artifact', `Stored session ${id} is not valid JSON.`);
    }
  }

  // List: metadata only.
  let files = [];
  try {
    files = (await readdir(dir)).filter((f) => f.endsWith('.json'));
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
  const sessions = [];
  for (const f of files) {
    try {
      const artifact = JSON.parse(await readFile(path.join(dir, f), 'utf8'));
      sessions.push(metadataOf(artifact, f.slice(0, -5)));
    } catch {
      /* skip partially-written or corrupt files */
    }
  }
  sessions.sort((a, b) => String(b.started_at ?? '').localeCompare(String(a.started_at ?? '')));
  return sendJson(res, 200, { ok: true, count: sessions.length, sessions });
}

export default async function handler(req, res) {
  const method = (req.method || 'GET').toUpperCase();
  try {
    if (method === 'POST') return await storeArtifact(req, res);
    if (method === 'GET') return await readSessions(req, res);
    if (method === 'OPTIONS') return sendNoContentOptions(res, 'GET, POST, OPTIONS');
    return sendJson(res, 405, { ok: false, error: 'method_not_allowed', message: 'Use GET or POST.' }, { allow: 'GET, POST, OPTIONS' });
  } catch (err) {
    return sendError(res, err, 'Failed to process session artifact.');
  }
}

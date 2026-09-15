// Shared HTTP helpers for the api/*.js functions and scripts/dev-server.mjs.
//
// Lives under api/_lib/ because Vercel excludes underscore-prefixed files and
// directories inside api/ from being built as serverless functions: this module
// is bundled into api/token.js and api/sessions.js but never deployed as its
// own endpoint. The default-export 404 handler below is a safety net in case
// that exclusion ever changes.
//
// Every helper is written to work with BOTH shapes of (req, res):
//   - Vercel Node functions (req.body pre-parsed JSON, req.query, res.status/json)
//   - raw node:http objects used by scripts/dev-server.mjs (stream body, writeHead)

export const NO_STORE = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
};

export class HttpError extends Error {
  constructor(status, code, message) {
    super(message || code);
    this.status = status;
    this.code = code;
  }
}

/** Send a JSON response on any res shape (Vercel helper res or raw node:http res). */
export function sendJson(res, status, payload, extraHeaders = {}) {
  const body = JSON.stringify(payload);
  const headers = { ...NO_STORE, ...extraHeaders };
  if (typeof res.writeHead === 'function') {
    res.writeHead(status, headers);
    res.end(body);
    return;
  }
  if (typeof res.status === 'function' && typeof res.json === 'function') {
    if (typeof res.setHeaders === 'function') res.setHeaders(headers);
    else if (typeof res.setHeader === 'function') {
      for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
    }
    res.status(status).json(payload);
    return;
  }
  res.statusCode = status;
  res.end(body);
}

/** Map any thrown value to a safe JSON error response (never leaks internals). */
export function sendError(res, err, fallbackMessage) {
  if (err instanceof HttpError) {
    return sendJson(res, err.status, { ok: false, error: err.code, message: err.message });
  }
  console.error('[api] unexpected error:', err);
  return sendJson(res, 500, { ok: false, error: 'internal_error', message: fallbackMessage || 'Unexpected server error.' });
}

/** Parsed query params: Vercel's req.query when present, else parse req.url. */
export function getQuery(req) {
  if (req.query && typeof req.query === 'object' && !Array.isArray(req.query)) {
    return req.query;
  }
  const out = {};
  try {
    const u = new URL(req.url || '', 'http://dev.local');
    u.searchParams.forEach((v, k) => {
      out[k] = v;
    });
  } catch {
    /* malformed url -> empty query */
  }
  return out;
}

function parseJsonText(text, maxBytes) {
  if (Buffer.byteLength(text, 'utf8') > maxBytes) {
    throw new HttpError(413, 'payload_too_large', `JSON body exceeds the ${maxBytes} byte limit.`);
  }
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new HttpError(400, 'invalid_json', `Body is not valid JSON (${e.message}).`);
  }
}

function readNodeStream(req, maxBytes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > maxBytes) {
        reject(new HttpError(413, 'payload_too_large', `Body exceeds the ${maxBytes} byte limit.`));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', (e) => reject(new HttpError(400, 'read_error', e.message)));
  });
}

/**
 * Read the request body as a parsed JSON object, robust to every (req) shape:
 *   1. req.body already an object/string (Vercel pre-parses JSON bodies; the
 *      dev server may also pre-attach it),
 *   2. req.__rawBody (the dev server buffers the stream and attaches a string),
 *   3. a web-standard Request (req.text()),
 *   4. a raw node:http stream.
 * Throws HttpError(400/413) on empty/invalid/oversized bodies.
 */
export async function readJsonBody(req, maxBytes = 2 * 1024 * 1024) {
  if (req.body !== undefined && req.body !== null && req.body !== '') {
    if (typeof req.body === 'string') return parseJsonText(req.body, maxBytes);
    return req.body;
  }
  let text = '';
  if (typeof req.__rawBody === 'string') text = req.__rawBody;
  else if (typeof req.text === 'function') text = await req.text();
  else text = await readNodeStream(req, maxBytes);
  if (!text || /^\s*$/.test(text)) {
    throw new HttpError(400, 'empty_body', 'Request body is empty — expected a JSON payload.');
  }
  return parseJsonText(text, maxBytes);
}

/**
 * Same-origin check (no CORS headers are ever emitted, so browsers already
 * block cross-origin reads; this also refuses explicit cross-origin signals).
 * Non-browser clients (curl, server-side fetch) send no Origin and pass.
 */
export function isSameOrigin(req) {
  const h = req.headers || {};
  const site = h['sec-fetch-site'];
  if (site && site !== 'same-origin' && site !== 'same-site' && site !== 'none') return false;
  const origin = h.origin;
  if (!origin || origin === 'null') return true;
  const host = h.host || h['x-forwarded-host'] || '';
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

/** Reply to a preflight/OPTIONS without a body (204 must be bodyless). */
export function sendNoContentOptions(res, allow) {
  const headers = { allow, 'cache-control': 'no-store' };
  if (typeof res.writeHead === 'function') {
    res.writeHead(204, headers);
    res.end();
  } else if (typeof res.status === 'function') {
    res.status(204);
    if (typeof res.setHeaders === 'function') res.setHeaders(headers);
    res.end();
  } else {
    res.statusCode = 204;
    res.end();
  }
}

export default function notAnEndpoint(req, res) {
  sendJson(res, 404, {
    ok: false,
    error: 'not_found',
    message: 'api/_lib/* are internal helper modules, not API endpoints.',
  });
}

// GET|POST /api/token — issue a one-time AssemblyAI Voice Agent token.
//
// The ASSEMBLYAI_API_KEY lives ONLY in server env (never shipped to the
// browser — architecture.md §3.2). Real mode proxies
//   GET https://agents.assemblyai.com/v1/token?expires_in_seconds=N
// with `Authorization: Bearer <key>` (verified contract in
// docs/research/assemblyai-notes.md). Without a key the endpoint returns a
// documented, intentional mock mode (architecture.md §9) — not an error.

import { sendJson, sendError, getQuery, readJsonBody, sendNoContentOptions, HttpError } from './_lib/http.js';

const UPSTREAM_TOKEN_URL = 'https://agents.assemblyai.com/v1/token';
const UPSTREAM_TIMEOUT_MS = 8000;
const DEFAULT_SECONDS = 300;
const MIN_SECONDS = 60;
const MAX_SECONDS = 600;

const MOCK_NOTICE =
  'ASSEMBLYAI_API_KEY not configured — running in mock mode. Set it in .env (see .env.example) for real voice sessions.';

function clampSeconds(raw) {
  const n = Number.parseInt(String(raw ?? '').trim(), 10);
  if (!Number.isFinite(n)) return DEFAULT_SECONDS;
  return Math.min(MAX_SECONDS, Math.max(MIN_SECONDS, Math.round(n)));
}

export default async function handler(req, res) {
  const method = (req.method || 'GET').toUpperCase();
  if (method === 'OPTIONS') return sendNoContentOptions(res, 'GET, POST, OPTIONS');
  if (method !== 'GET' && method !== 'POST') {
    return sendJson(res, 405, { ok: false, error: 'method_not_allowed', message: 'Use GET or POST.' }, { allow: 'GET, POST, OPTIONS' });
  }

  try {
    const query = getQuery(req);
    let seconds = clampSeconds(query.expires_in_seconds);
    if (method === 'POST' && query.expires_in_seconds === undefined) {
      // Accept {"expires_in_seconds": 120} in the POST body as an alternative.
      try {
        const body = await readJsonBody(req, 64 * 1024);
        if (body && typeof body === 'object' && !Array.isArray(body)) {
          seconds = clampSeconds(body.expires_in_seconds);
        }
      } catch (e) {
        if (!(e instanceof HttpError) || e.status !== 400) throw e;
        // No/invalid body on POST is tolerable: the default TTL stands.
      }
    }

    const apiKey = (process.env.ASSEMBLYAI_API_KEY || '').trim();
    if (!apiKey) {
      return sendJson(res, 200, {
        mode: 'mock',
        token: 'mock-token',
        expires_in_seconds: 0,
        ttl: 0, // alias kept for architecture.md §9 clients
        notice: MOCK_NOTICE,
      });
    }

    let upstream;
    try {
      upstream = await fetch(`${UPSTREAM_TOKEN_URL}?expires_in_seconds=${seconds}`, {
        method: 'GET',
        headers: { authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
      });
    } catch (e) {
      if (e && (e.name === 'TimeoutError' || e.name === 'AbortError')) {
        return sendJson(res, 502, {
          ok: false,
          error: 'upstream_timeout',
          message: `Timed out after ${UPSTREAM_TIMEOUT_MS / 1000}s contacting agents.assemblyai.com — try again.`,
        });
      }
      return sendJson(res, 502, {
        ok: false,
        error: 'upstream_unreachable',
        message: 'Could not reach agents.assemblyai.com — network error on the server.',
      });
    }

    const text = await upstream.text();
    let parsed = null;
    try {
      parsed = JSON.parse(text);
    } catch {
      /* non-JSON upstream body handled below */
    }

    if (!upstream.ok || !parsed || typeof parsed.token !== 'string' || !parsed.token) {
      // Deliberately echoes ONLY upstream status/error text — never the key
      // or the Authorization header.
      const detail =
        (parsed && (parsed.error || parsed.code)) || (text && text.slice(0, 200)) || 'empty upstream response';
      return sendJson(res, 502, {
        ok: false,
        error: 'upstream_token_error',
        upstream_status: upstream.status,
        message: `AssemblyAI token endpoint failed (HTTP ${upstream.status}): ${detail}. Check ASSEMBLYAI_API_KEY and retry.`,
      });
    }

    return sendJson(res, 200, {
      mode: 'real',
      token: parsed.token,
      expires_in_seconds: typeof parsed.expires_in_seconds === 'number' ? parsed.expires_in_seconds : seconds,
    });
  } catch (err) {
    return sendError(res, err, 'Failed to issue token.');
  }
}

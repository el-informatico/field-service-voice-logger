#!/usr/bin/env node
// Zero-dependency local dev server (node:http, Node >= 22, ESM).
//
//   /           -> web/    (static: index.html, js/, css/)
//   /data/*     -> data/   (static JSON, mirrors the /data rewrite in vercel.json)
//   /api/*      -> the SAME handlers from api/*.js (Vercel (req,res) signature;
//                  POST bodies are buffered onto req.__rawBody and the shared
//                  readJsonBody() in api/_lib/http.js parses them — on Vercel,
//                  req.body arrives pre-parsed, both paths are handled)
//
// Env: PORT (default 3000), HOST (default 127.0.0.1), SESSIONS_DIR (default
// .data/sessions), ASSEMBLYAI_API_KEY (from .env, see .env.example).

import { existsSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import tokenHandler from '../api/token.js';
import sessionsHandler from '../api/sessions.js';
import { sendJson } from '../api/_lib/http.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WEB_ROOT = path.resolve(ROOT, 'web');
const DATA_ROOT = path.resolve(ROOT, 'data');
const DEV_BODY_CAP = 16 * 1024 * 1024; // dev-server memory guard; /api/sessions enforces 2 MB itself

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.txt': 'text/plain; charset=utf-8',
  '.ico': 'image/x-icon',
  '.map': 'application/json; charset=utf-8',
};

// --- .env loader (no deps): real environment variables always win over .env ---
function loadDotEnv() {
  const file = path.join(ROOT, '.env');
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (!m || process.env[m[1]] !== undefined) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    process.env[m[1]] = v;
  }
}

// --- helpers -----------------------------------------------------------------

function readBody(req, capBytes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let done = false;
    req.on('data', (c) => {
      size += c.length;
      if (size > capBytes) {
        done = true;
        reject(new Error('payload_too_large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      if (!done) resolve(Buffer.concat(chunks).toString('utf8'));
    });
    req.on('error', (e) => {
      if (!done) reject(e);
    });
  });
}

const FSVL_404_PAGE = `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><title>404 — Field Service Voice Logger</title>
<style>body{font-family:system-ui,sans-serif;margin:3rem auto;max-width:34rem;color:#333}code{background:#f3f3f3;padding:.1rem .3rem;border-radius:4px}</style>
</head><body><h1>404 — no existe</h1>
<p>El dev server no encontró esa ruta. Rutas servidas:</p>
<ul>
<li><code>/</code> — estáticos de <code>web/</code></li>
<li><code>/data/*</code> — JSONs de <code>data/</code></li>
<li><code>GET|POST /api/token</code></li>
<li><code>GET|POST /api/sessions</code></li>
</ul></body></html>`;

function notFoundHtml(res, pathname) {
  const body = FSVL_404_PAGE.replace('__PATH__', pathname);
  res.writeHead(404, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
  res.end(body);
}

/** Serve a file from rootDir with a path-traversal guard. Safe for dirs -> index.html. */
async function serveStatic(res, urlPath, rootDir) {
  let decoded;
  try {
    decoded = decodeURIComponent(urlPath);
  } catch {
    return notFoundHtml(res, urlPath);
  }
  if (decoded.includes('\0')) return notFoundHtml(res, urlPath);

  const rel = path.posix.normalize(decoded).replace(/^\/+/, '');
  const abs = path.resolve(rootDir, rel);
  if (abs !== rootDir && !abs.startsWith(rootDir + path.sep)) {
    return notFoundHtml(res, urlPath); // traversal attempt
  }

  let target = abs;
  try {
    const s = await stat(abs);
    if (s.isDirectory()) target = path.join(abs, 'index.html');
    await stat(target);
  } catch {
    return notFoundHtml(res, urlPath);
  }
  try {
    const data = await readFile(target);
    const type = MIME[path.extname(target).toLowerCase()] || 'application/octet-stream';
    res.writeHead(200, { 'content-type': type, 'content-length': data.length, 'cache-control': 'no-cache' });
    res.end(data);
  } catch {
    notFoundHtml(res, urlPath);
  }
}

// --- server ------------------------------------------------------------------

loadDotEnv();

const server = createServer(async (req, res) => {
  let pathname = '/';
  try {
    pathname = new URL(req.url || '/', 'http://dev.local').pathname;
  } catch {
    /* keep '/' */
  }

  try {
    if (pathname === '/api' || pathname.startsWith('/api/')) {
      const route = pathname.length > 1 && pathname.endsWith('/') ? pathname.slice(0, -1) : pathname;
      const handler = route === '/api/token' ? tokenHandler : route === '/api/sessions' ? sessionsHandler : null;
      if (!handler) {
        return sendJson(res, 404, {
          ok: false,
          error: 'not_found',
          message: `No API route ${route}. Available: GET|POST /api/token, GET|POST /api/sessions.`,
        });
      }
      const method = (req.method || 'GET').toUpperCase();
      if (method === 'POST' || method === 'PUT' || method === 'PATCH') {
        req.__rawBody = await readBody(req, DEV_BODY_CAP);
      }
      return await handler(req, res);
    }

    if (pathname === '/data' || pathname.startsWith('/data/')) {
      // Strip the /data mount prefix: DATA_ROOT already points at data/.
      const underData = pathname.replace(/^\/data(?=\/|$)/, '') || '/';
      return await serveStatic(res, underData, DATA_ROOT);
    }
    return await serveStatic(res, pathname, WEB_ROOT);
  } catch (err) {
    if (res.headersSent) {
      res.destroy(err);
      return;
    }
    const isTooLarge = err && err.message === 'payload_too_large';
    sendJson(
      res,
      isTooLarge ? 413 : 500,
      {
        ok: false,
        error: isTooLarge ? 'payload_too_large' : 'internal_error',
        message: isTooLarge ? `Dev-server body cap exceeded (${DEV_BODY_CAP} bytes).` : 'Dev server error.',
      }
    );
  }
});

const PORT = Number.parseInt(process.env.PORT || '3000', 10) || 3000;
// Default ::1 (IPv6 loopback): on WSL2 mirrored networking 127.0.0.1 connections
// can hang, while ::1 works everywhere Linux does. Override with HOST=0.0.0.0 etc.
const HOST = process.env.HOST || '::1';
const isV6 = HOST.includes(':');
const displayHost = HOST === '::' || HOST === '0.0.0.0' ? 'localhost' : isV6 ? `[${HOST}]` : HOST;
const probeHost = HOST === '::' ? '[::1]' : HOST === '0.0.0.0' ? '127.0.0.1' : isV6 ? `[${HOST}]` : HOST;

server.listen(PORT, HOST, () => {
  console.log(`[dev-server] repo root : ${ROOT}`);
  console.log(`[dev-server] routes    : / -> web/ , /data/* -> data/ , /api/token , /api/sessions`);
  console.log(`[dev-server] listening : http://${displayHost}:${PORT}  (bind ${HOST}; HOST=0.0.0.0 for LAN)`);
  (async () => {
    try {
      const r = await fetch(`http://${probeHost}:${PORT}/api/token`, {
        signal: AbortSignal.timeout(3000),
      });
      const j = await r.json();
      if (j.mode === 'real') {
        console.log(`[dev-server] mode      : real (AssemblyAI tokens, expires_in_seconds=${j.expires_in_seconds})`);
      } else {
        console.log(`[dev-server] mode      : mock — ${j.notice}`);
      }
    } catch (e) {
      console.error(`[dev-server] mode      : unknown (/api/token probe failed: ${e.message})`);
    }
  })();
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 1500).unref();
  });
}

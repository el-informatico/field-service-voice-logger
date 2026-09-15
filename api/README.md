# api/ — serverless functions (Vercel Node 22, zero npm deps)

| Endpoint | Methods | Behavior |
|---|---|---|
| `/api/token` | GET, POST | One-time AssemblyAI Voice Agent token. Query `expires_in_seconds` (default 300, clamped 60–600). Same behavior for GET and POST. |
| `/api/sessions` | POST | Stores a session artifact (schema: `docs/architecture.md` §6). Body ≤ 2 MB. |
| `/api/sessions` | GET | `?id=` → full artifact JSON; without id → list, metadata only (`id, order_id, started_at, ended_at, scenario_id, mode`). |

## Real vs mock mode (`/api/token`)

- `ASSEMBLYAI_API_KEY` set (server env only): proxies `GET https://agents.assemblyai.com/v1/token`
  with `Authorization: Bearer <key>` → `{ mode: "real", token, expires_in_seconds }`.
  Upstream failures return 502 with a clear message that never leaks the key.
- Key unset: `200 { mode: "mock", token: "mock-token", expires_in_seconds: 0, ttl: 0, notice }` —
  an intentional, documented dev mode (`docs/architecture.md` §9), not an error.
- Where the key goes: locally `.env` (copy `.env.example`; `scripts/dev-server.mjs` loads it);
  on Vercel: `vercel env add ASSEMBLYAI_API_KEY` — never into `web/`.

## Privacy invariants (enforced server-side)

- `audio_retained` must be exactly `false` → otherwise **400**: the server refuses to store
  a session claiming retained audio.
- Any string field > 64 KB → **400 "audio-like payload refused"** (base64-audio smuggling guard).
- Audio never transits or lands on the server: artifacts carry transcript + tool events + final form.
- Responses are `Cache-Control: no-store`; no CORS headers (same-origin only).

## Storage is ephemeral

Artifacts are written to `SESSIONS_DIR` (default `.data/sessions` locally; `/tmp/fsvl-sessions`
on Vercel, whose filesystem is wiped when the instance recycles — responses carry `ephemeral_note`).
Durable storage is decision D5: replace the `writeFile` in `api/sessions.js#storeArtifact`
(e.g. Cloudflare D1, Upstash, any DB) — the response shape stays the same.

`_lib/` holds shared helpers (underscore ⇒ not deployed as a function). `selfcheck.sh` is the curl-based smoke test.

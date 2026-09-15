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

## FSM connector (simulated) — `api/fsm.js`

| Endpoint | Methods | Behavior |
|---|---|---|
| `/api/fsm/report` | POST | Simulated field-service-management intake of a closed order. Body `{order_id, final_form, session_id, sent_at?}` (≤ 1 MB) → `{ok:true, accepted:true, fsm_id:"FSM-<yyyymmdd>-<rand6>", order_id, received_at, stored, ephemeral_note}`. |
| `/api/fsm/report` | GET | List of sent acks, metadata only (`fsm_id, order_id, session_id, received_at`), newest first. |

- Same invariants as `/api/sessions`: same-origin only, `Cache-Control: no-store`, no CORS;
  `audio_retained` — if sent at all — must be exactly `false` (400 otherwise), and any string
  field over 64 KB is refused (audio-smuggling guard). `order_id`/`session_id` must match
  `[A-Za-z0-9_-]{1,64}`.
- Acks are written as JSON to `FSM_DIR` (default `.data/fsm` locally; `/tmp/fsvl-fsm` on Vercel —
  same ephemeral-disk caveat as sessions). The local dev server routes `/api/fsm/*` to this handler.
- This is the demo connector: swap `storeReport()` in `api/fsm.js` for the real FSM API call
  (decision D5); the response shape stays the same.

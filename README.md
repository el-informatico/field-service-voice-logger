# Field Service Voice Logger

A real-time voice agent for field-service technicians. You narrate the repair with
your hands busy; the agent **interviews you, fills the work order live via tools,
and reads critical data back out loud** ("did you say the **3/4** valve?") until
the work order is provably correct. No typing, no post-job paperwork, no
transcribe-then-summarize.

**The product is the confirmed accuracy.** Every session emits an auditable
timeline artifact (JSON) and we publish measured extraction accuracy, spoken
confirmation-loop precision/recall, end-of-speech→tool-call latency (p50/p95),
WER clean vs +noise, and barge-in respected-vs-stolen. See [Metrics](#metrics).

> Built for the [AssemblyAI Voice Agent Hackathon](https://lablab.ai/ai-hackathons/assemblyai-voice-agent-hackathon) (Sept 2026).
> Status: pre-sprint scaffold — real voice sessions start D1 of the sprint. See [STATUS.md](STATUS.md).

## Why (the 45-minute problem)

Field technicians spend 30–60 min per job on paperwork, often after hours, from
memory. Existing "voice to form" tools are one-shot dictation; conversational
copilots exist (Aquant Roger, Oxmaint, Arrival AI), and read-back loops are
appearing in adjacent verticals (phone intake, operating rooms) — but **nobody
applies the spoken confirmation loop to field-service work orders, and nobody in
this hackathon's 61 submissions publishes measured extraction accuracy**. That
loop — read-back of part numbers and quantities that sound alike (3/4" vs 3/8") —
is what makes a voice-filled work order trustworthy enough to invoice against.
Technicians ask for exactly this ([r/FieldService](https://www.reddit.com/r/FieldService/comments/1ldrsr2/could_calling_an_ai_help_field_service_workers/)).

## How it works

1. Technician opens the job on their phone, **consent screen first** (audio is
   never stored — see [Privacy](#privacy-by-design)), taps start.
2. Real-time duplex session with the AssemblyAI Voice Agent API: VAD tuned for
   **long working pauses** (low `vad_threshold`, high `min_silence`) and real
   **barge-in** ("wait — it was the other valve!") — turn detection parameters
   per the [official docs](https://www.assemblyai.com/docs/voice-agents/voice-agent-api/turn-detection-and-interruptions).
3. Every statement becomes a **client-side tool call with JSON Schema**:
   `get_orden`, `buscar_pieza`, `agregar_pieza_a_reporte` (SKU validated against
   the catalog via `enum`), `set_problema`, `set_solucion`, `get_tiempo_trabajo`,
   `enviar_reporte`. The work order fills in live on screen.
4. Critical values (parts, quantities) are **read back out loud** and confirmed.
   Confusable SKUs are caught twice: by the schema `enum` and by the spoken loop.
5. Session ends → work order artifact (timeline JSON + final form) → **PDF/CSV
   export** and a metrics run. Raw audio is discarded by design.

## Metrics

Produced by [metrics/](metrics/README.md) from session artifacts; definitions are
exact and reproducible. **First 5 REAL voice sessions** (Voice Incident Reporter,
post-visit quiet dictation, scripted operator, AssemblyAI Voice Agent API,
prompt v3; artifacts under `.data/gate/`):

| Metric | Value | N | Condition |
|---|---|---|---|
| Turn completion (scripted turns transcribed) | 8–10 of 10–11 per session | 5 sessions | quiet dictation |
| WER, matched pairs | **0.231** (0.164–0.382/session) | 1,081 ref words | quiet dictation |
| End-of-speech → tool call, p50 / p95 | 1,775 ms / 6,192 ms | 23 tool turns | real API |
| Severidad exacta | 2/5 sessions | 5 | read-back loop |
| Servicios afectados set precision | 100% (3 TP / 0 FP) | 5 | catalog enum |
| Servicios afectados set recall | 37.5% (5 FN) | 5 | see notes |
| Timeline eventos (hora+evento) | 3/3 in both sessions that ran the timeline flow; 0 in the rest | 5 | see notes |
| Confirmation-loop precision (read-backs → correction) | 61.5% | 13 read-backs | real dialogue |

Honest notes: (1) high run-to-run variance of the interview agent — 2 of 5
sessions (the pure-narrative script i1) collapsed to 1 tool call and were
scored at zero extraction; sessions that engaged (i2/i3) reached 100% service
precision, 3/3 timeline events and correct severity. (2) One session timed out
(watchdog 300 s, documented). (3) Aggregate chronological WER (1.05) and
agent-first-word latency are excluded as pairing/event-ordering artifacts of
the driver — matched-pair WER is the reported figure. (4) Numbers will be
re-published with a larger N as the interview prompt converges.

CI-proven in mock mode (`npm run smoke:mock`, deterministic, no API key): the
session artifacts match the seeded ground truth exactly — services/timeline/
action-items/severidad P/R 100%, all 3 seeded capture errors rescued by the
spoken confirmation loop, WER 0.006. The earlier field-service (work-order)
product's live-interview route failed its noise gate at 10 dB (see
[docs/D2-GATE-RESULTS.md](docs/D2-GATE-RESULTS.md)) — that evidence drove the
pivot to post-visit quiet dictation, which designs the failure mode out.

## How we differ from Relay (and the field)

Based on the gallery audit of 2026-09-15 (61 submissions; full evidence in
[docs/research/competitor-landscape-2026-09-15.md](docs/research/competitor-landscape-2026-09-15.md)):

- **[Relay](https://lablab.ai/ai-hackathons/assemblyai-voice-agent-hackathon/relay/relay-voice-operations-for-field-work)** is the direct field-service entry. They say it best themselves:
  *"Relay is not a voice form filler. It is a voice operations agent that executes work."*
  Exactly — we are the voice form filler they explicitly decline to be, and we
  add what no operations agent shows: **spoken read-back of captured values
  before committing them** (their "verified" refers to workflow outcomes —
  inventory, transfers — not to data captured from speech), a work order that
  fills live with a per-field audit trail, **PDF/CSV export**, and **measured
  extraction accuracy + noise/latency tests**. None of those appear in their
  public materials as of 2026-09-15.
- **[QuoteReady](https://lablab.ai/ai-hackathons/assemblyai-voice-agent-hackathon/quoteready/quoteready)** is the closest in *form* — corrected read-back, transcript evidence per answer, caller approval — but in *domain* it is inbound phone intake for pre-work quotes (5 fields, JSON draft). We log the **post-work repair record** for a hands-busy technician: parts SKUs validated against a catalog, quantities, work time, invoicing-grade output. Their own materials mark real-speaker and interruption evaluation as "future work"; measured accuracy is our deliverable, not an afterthought.
- **Zero of 61 submissions publish measured extraction accuracy.** The
  "evidence-linked intake" pattern is crowding adjacent verticals (EvidenTurn —
  consumer complaints; AegisOR — OR read-back compliance; Voicemed — SOAP notes),
  so we don't claim the pattern — we claim **the domain (field service +
  industrial noise) plus the published numbers**: accuracy per field type vs
  seeded ground truth, confirmation-loop precision/recall, latency p50/p95,
  WER clean vs +noise (DEMAND), barge-in respected vs stolen.
- vs. market tools (Salesforce Voice-to-Form, Benetics, Hardline, Neuron7,
  Valoon — dictation; Aquant Roger, Oxmaint, Arrival AI — conversational CMMS):
  same wedge — **measured, published confirmation quality**, not claims.

> Caveat from the audit: AutoCopilot (fleet technicians) and KiaOra Dispatch
> could not be verified (empty JS-rendered pages). The gallery moves fast
> (+6 submissions on audit day); we re-audit before finalizing the video pitch
> (see docs/plan.md, D6).

## Architecture

```
Browser (static, no build)                 Serverless (Vercel)
┌──────────────────────────┐              ┌─────────────────────┐
│ mic ──► WebSocket ───────┼─────────────►│ api/token.js        │  one-time temp token,
│   wss://agents.assemblyai│◄─────────────│  (key never in JS)  │  API key server-side
│ tools (JSON Schema,enum) │              └─────────────────────┘
│ work-order state + audit │              ┌─────────────────────┐
│ artifact builder ────────┼─────────────►│ api/sessions.js     │  stores transcript+tool
│ audio: memory only ✗disk │              └─────────────────────┘  state, NEVER audio
└──────────────────────────┘
```

Details and schemas: [docs/architecture.md](docs/architecture.md) · API research notes:
[docs/research/assemblyai-notes.md](docs/research/assemblyai-notes.md).

## Run locally

```bash
cp .env.example .env          # add ASSEMBLYAI_API_KEY for real voice; omit for mock mode
npm run dev                   # http://localhost:3000
npm run selftest              # metrics harness self-test + seed-data validation
npm run smoke:mock            # end-to-end mock session → artifact → metrics table
```

Mock mode (no API key) runs the full pipeline — tools, live form, confirmation
loop, artifact, metrics — with a deterministic rule-based interviewer, so the
repo is testable CI-style without spending a cent or recording anyone.

## Privacy by design

- Session starts only when the technician taps start (never ambient listening).
- Visible consent screen before the mic opens.
- **Raw audio is never uploaded or persisted** — transcript + tool events + final
  form only (`"audio_retained": false` is part of the artifact).
- Demo recordings only with consenting participants.

## License

Apache-2.0 — see [LICENSE](LICENSE). © 2026 el-informatico

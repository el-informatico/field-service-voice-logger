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
> Status: built and measured — **10 real voice sessions** against the live
> AssemblyAI API (metrics below), demo video recorded, submission pack in
> [docs/SUBMISSION.md](docs/SUBMISSION.md). Live progress: [STATUS.md](STATUS.md).

## Why (the 45-minute problem)

Field technicians spend 30–60 min per job on paperwork, often after hours, from
memory. Existing "voice to form" tools are one-shot dictation; conversational
copilots exist (Aquant Roger, Oxmaint, Arrival AI), and read-back loops are
appearing in adjacent verticals (phone intake, operating rooms) — but **nobody
applies the spoken confirmation loop to field-service work orders, and nobody in
this hackathon's 63 submissions (re-audited 2026-09-17) publishes measured
extraction accuracy**. That
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
exact and reproducible. **10 REAL voice sessions** (Voice Incident Reporter,
post-visit quiet dictation, scripted operator, AssemblyAI Voice Agent API;
5 sessions on interview prompt v3 + 5 on prompt v4, the narrative-capture fix
documented in [STATUS.md](STATUS.md) METRICS-N10; artifacts under `.data/gate/`):

| Metric | Value | N | Condition |
|---|---|---|---|
| Turn completion (scripted turns transcribed) | 7–10 of 9–11 per session | 10 sessions | quiet dictation |
| WER, matched pairs | **0.231** (0.164–0.382/session) | 2,134 ref words | quiet dictation |
| End-of-speech → tool call, p50 / p95 | 1,554 ms / 4,810 ms | 53 tool turns | real API |
| Severidad exacta | 6/10 sessions | 10 | read-back loop |
| Servicios afectados set precision | 100% (12 TP / 0 FP) | 10 | catalog enum |
| Servicios afectados set recall | 70.6% (5 FN) | 10 | see notes |
| Timeline horas exactas | 19/35 GT events (54.3%) | 10 | hora exacta; see notes |
| Confirmation-loop precision (read-backs → correction) | 62.1% | 29 read-backs | real dialogue |
| Barge-in respected (designed interrupt → reply cut ≤500 ms) | **0/3** (1,338 / 9,034 / 20,501 ms) | 3 designed interrupts | hour-correction script; see notes |

Prompt-v4 sessions alone (same scripts, same conditions): service set
precision/recall **100%/100%** (9 TP / 0 FP / 0 FN), timeline hours **13/18
(72.2%)**, severity 4/5, EOS→tool p50 **1,139 ms** — vs 37.5% recall, 35.3%
timeline hours, 2/5 severity, 1,775 ms for the v3 half. WER is 0.231 in both
halves: the fix changed tool-call discipline, not hearing. The pure-narrative
script that used to collapse to 1 tool call (v3) now registers 10–15 tool
calls and 7/8 timeline hours across its two v4 sessions.

Honest notes: (1) run-to-run variance of the interview agent persists — the
v3 narrative collapse is fixed, but one v4 session (R5b) still spoke
read-backs without registering the timeline (0/3 hours); v4 mitigates, does
not eliminate. (2) Two sessions hit the 300 s driver watchdog (R2a, R5b) and
lost their final turns — R5b's severity miss is the correction turn that
never played. (3) Turn-completion misses are VAD splits of long turns and
empty final transcripts (driver artifacts), not agent refusals. (4) Strict
timeline (hour + event text sim ≥ 0.6) is 0 TP in every session: the agent
captures the operator's verbatim phrasing while the ground truth stores clean
phrases — hour-exact match is the reported signal. (5) The designed
capture-error rescue (rack A8 heard → corrected to A3) completed in real
session R5d; derived rescue counts undercount when the operator answers with
content ("producción") instead of yes/no. (6) No session (v3 or v4) reached
`enviar_reporte` — the rig closes the socket after the last scripted reply,
so `estado` stays `en_proceso` in every artifact. (7) Aggregate chronological
WER and agent-first-word latency stay excluded as driver artifacts —
matched-pair WER is the reported figure. (8) Designed barge-ins never made
the 500 ms respect window: the hour-correction turn (the one scripted
interrupt, three i3 runs — R3a/R3b/R5c) measured 1,338 / 9,034 / 20,501 ms
speech-start → reply-cut with `interrupt_response: true,
interruption_delay: 0` configured throughout; 25 further opportunistic
`barge_in` events carry no timing anchor and are excluded by the canonical
metric ([metrics/lib/bargein.js](metrics/lib/bargein.js)). This is the same
C3 weakness that failed the work-order D2 gate (1/3, 0/3 at 10 dB,
[docs/D2-GATE-RESULTS.md](docs/D2-GATE-RESULTS.md)) and drove the pivot to
quiet post-visit dictation with a spoken confirmation loop.

CI-proven in mock mode (`npm run smoke:mock`, deterministic, no API key): the
session artifacts match the seeded ground truth exactly — services/timeline/
action-items/severidad P/R 100%, all 4 seeded capture errors rescued by the
spoken confirmation loop, WER 0.006. The earlier field-service (work-order)
product's live-interview route failed its noise gate at 10 dB (see
[docs/D2-GATE-RESULTS.md](docs/D2-GATE-RESULTS.md)) — that evidence drove the
pivot to post-visit quiet dictation, which designs the failure mode out.

## Demo video (D6)

Script beat-by-beat with timestamps: [docs/video-script-en.md](docs/video-script-en.md) ·
recording plan: [docs/video-recording-plan.md](docs/video-recording-plan.md) ·
one-command demo: `bash scripts/demo-video.sh` ([docs/video-demo-setup.md](docs/video-demo-setup.md)).

The 5-minute pitch in one paragraph: field teams lose up to an hour a day
writing visits up from memory; dictation alone can't tell a report from a
guess. Our agent interviews the operator after the visit (quiet environment —
by design, see the [noise-gate evidence](docs/D2-GATE-RESULTS.md) that drove
this), structures the incident live, and **reads the critical values back out
loud** — service PROD vs STAGING, severities, timeline hours — until the
record is provably right. vs **Relay** (same event, field-ops lane): they say
it themselves — *"Relay is not a voice form filler"*; they execute operations,
we are the documentary layer with the confirmation loop and the **published,
reproducible metrics** (failures included). vs **QuoteReady**: read-back on
inbound phone quotes — pre-work intake, not the post-visit record; their own
page marks real-speaker evaluation as future work, our numbers are on the
table.

## How we differ from Relay (and the field)

Based on the gallery audits of 2026-09-15 and 2026-09-17 (61 → 63 submissions;
full evidence in
[docs/research/competitor-landscape-2026-09-15.md](docs/research/competitor-landscape-2026-09-15.md)
and [docs/GALLERY-AUDIT-0917.md](docs/GALLERY-AUDIT-0917.md)):

- **[Relay](https://lablab.ai/ai-hackathons/assemblyai-voice-agent-hackathon/relay/relay-voice-operations-for-field-work)** is the direct field-service entry. They say it best themselves:
  *"Relay is not a voice form filler. It is a voice operations agent that executes work."*
  Exactly — we are the voice form filler they explicitly decline to be, and we
  add what no operations agent shows: **spoken read-back of captured values
  before committing them** (their "verified" refers to workflow outcomes —
  inventory, transfers — not to data captured from speech), a work order that
  fills live with a per-field audit trail, **PDF/CSV export**, and **measured
  extraction accuracy + noise/latency tests**. None of those appear in their
  public materials as of the 2026-09-17 re-audit.
- **[QuoteReady](https://lablab.ai/ai-hackathons/assemblyai-voice-agent-hackathon/quoteready/quoteready)** is the closest in *form* — corrected read-back, transcript evidence per answer, caller approval — but in *domain* it is inbound phone intake for pre-work quotes (5 fields, JSON draft). We log the **post-work repair record** for a hands-busy technician: parts SKUs validated against a catalog, quantities, work time, invoicing-grade output. Their own materials mark real-speaker and interruption evaluation as "future work"; measured accuracy is our deliverable, not an afterthought.
- **Zero of 63 submissions publish measured extraction accuracy** (audits of
  2026-09-15 and 2026-09-17). The closest is Robin Voice Ops, which publishes a
  scenario pass-rate and decision-latency percentiles — not per-field
  precision/recall vs ground truth, not WER, not confirmation-loop precision;
  nothing in the gallery does. Meanwhile the "evidence-linked intake" pattern
  keeps crowding adjacent verticals (EvidenTurn — consumer complaints; AegisOR —
  OR read-back compliance; Voicemed — SOAP notes; since 09-15 also: insurance
  claim intake, investor debriefs), so we don't claim the pattern — we claim
  **the domain (field service + industrial noise) plus the published numbers**:
  accuracy per field type vs seeded ground truth, confirmation-loop
  precision/recall, latency p50/p95, WER clean vs +noise (DEMAND), barge-in
  respected vs stolen.
- vs. market tools (Salesforce Voice-to-Form, Benetics, Hardline, Neuron7,
  Valoon — dictation; Aquant Roger, Oxmaint, Arrival AI — conversational CMMS):
  same wedge — **measured, published confirmation quality**, not claims.

> Caveat from the audits: KiaOra Dispatch was verified at the 2026-09-17
> re-audit — NZ property-maintenance **emergency dispatch** (inbound tenant
> calls, P1/P2/P3 tiers), not post-visit documentation, and it publishes no
> accuracy. AutoCopilot (fleet technicians) still renders an empty page and
> stays unverifiable. The gallery moved 61 → 63 in two days (+8 flagged on
> re-audit day); evidence with URLs and access dates in
> [docs/GALLERY-AUDIT-0917.md](docs/GALLERY-AUDIT-0917.md), and a final
> count-check lands with the submission itself.

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

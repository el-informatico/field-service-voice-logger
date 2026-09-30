# Field Service Voice Logger

A voice agent for field-service technicians. After the visit — quiet, minutes
after the work, hands free — the technician opens the incident and just talks;
the agent **interviews them, fills the incident report live via tools, and
reads critical values back out loud** ("did you say **production**? the catalog
also has staging") until the record is provably correct. No typing, no
post-job paperwork, no transcribe-then-summarize. (Live voice *during* the
repair was tried and gated out by evidence — see
[docs/D2-GATE-RESULTS.md](docs/D2-GATE-RESULTS.md); the product is the
post-visit interview.)

**The product is the confirmed accuracy.** Every session emits an auditable
timeline artifact (JSON) and we publish measured extraction accuracy, spoken
confirmation-loop precision/recall, end-of-speech→tool-call latency (p50/p95),
and WER — plus the work-order noise-gate evidence and the development set's
barge-in numbers. See [Metrics](#metrics).

> Built for the [AssemblyAI Voice Agent Hackathon](https://lablab.ai/ai-hackathons/assemblyai-voice-agent-hackathon) (Sept 2026).
> Status: built and measured — **10 real voice sessions on the English
> build** against the live AssemblyAI API (metrics below; the original
> Spanish-language development set is published alongside it), demo video
> recorded, submission pack in
> [docs/SUBMISSION.md](docs/SUBMISSION.md). Live progress: [STATUS.md](STATUS.md).
>
> **Born in Spanish** on seed data reflecting a Mexican field-service company
> (authored incident and service catalogs, not field recordings); the live
> incident domain rewritten end-to-end in English in the final 24 hours — and
> re-measured there (N=10) — with the legacy work-order domain kept in its
> original Spanish data as evidence of the shared engine.
>
> **Commit history kept as-is:** the project was born in Spanish — seed data
> reflecting a Mexican field-service company — and rewritten to English in the
> final 24 hours; the history is the honest record of that journey.

## Why (the 45-minute problem)

Field technicians spend 30–60 min per job on paperwork, often after hours, from
memory. Existing "voice to form" tools are one-shot dictation; conversational
copilots exist (Aquant Roger, Oxmaint, Arrival AI), and read-back loops are
appearing in adjacent verticals (phone intake, operating rooms) — but **nobody
applies the spoken confirmation loop to field-service records, and nobody in
this hackathon's audited submissions (61 at the 2026-09-15 audit, 63 at the
09-17 re-audit, 94 live at the 2026-09-21 dashboard check) publishes measured
extraction accuracy**. That
loop — read-back of part numbers and quantities that sound alike (3/4" vs 3/8") —
is what makes a voice-filled work order trustworthy enough to invoice against.
Technicians ask for exactly this ([r/FieldService](https://www.reddit.com/r/FieldService/comments/1ldrsr2/could_calling_an_ai_help_field_service_workers/)).

## How it works

1. Technician opens the incident on their phone, **consent screen first** (audio is
   never stored — see [Privacy](#privacy-by-design)), taps start.
2. Real-time duplex session with the AssemblyAI Voice Agent API (raw WebSocket,
   no SDK): VAD tolerant of working pauses, **barge-in** enabled ("wait — it
   started at five forty, not seven") — turn detection parameters
   per the [official docs](https://www.assemblyai.com/docs/voice-agents/voice-agent-api/turn-detection-and-interruptions).
3. Every statement becomes a **client-side tool call with JSON Schema**:
   `get_incident`, `search_service`, `set_what_happened`, `set_summary`,
   `set_severity`, `add_timeline_event`, `add_affected_service`
   (service validated against the catalog via `enum`), `add_action_item`,
   `send_report`. The incident card (the "ficha") fills in live on screen,
   each field carrying its own audit trail (which tool set it, when, confirmed
   by voice or edited by hand). All nine are tabulated below.
4. Critical values — services, severity, timeline hours — are **read back out
   loud** and confirmed. Confusable services are caught twice: by the schema
   `enum` and by the spoken loop.
5. Session ends → incident artifact (timeline JSON + final form) → **PDF/CSV
   export** and a metrics run. Raw audio is discarded by design.

The original work-order variant (same engine; tools for parts/SKUs and
quantities) remains in the repo — ~70% of the code is shared, and its
noise-gate evidence is what drove the post-visit pivot.

### The nine incident tools (JSON-Schema function calling)

Every operator statement lands as one of nine client-side function tools —
source of truth: [web/js/domain/incident/tools.js](web/js/domain/incident/tools.js).
2026-09-30: tool names renamed to English post-measurement (was `get_incidente`,
`set_resumen`, … — the N=10 evidence in docs/evidence/gate/ keeps the pre-rename
names); form field names keep their original Spanish, and severity values are
English enums in the current build.

| Tool | Parameters | Effect |
|---|---|---|
| `get_incident` | `{incidente_id?}` | Loads the session's active incident (customer, site, equipment, initial report) |
| `set_summary` | `{texto}` | Sets the one-line summary that heads the report card |
| `set_what_happened` | `{texto}` | Stores the operator's narrative verbatim — no paraphrase, jargon kept |
| `search_service` | `{consulta}` | Tolerant catalog search (name, jargon, alias); returns best candidate + alternatives + `confusable_warning` |
| `add_affected_service` | `{id: enum(servicios), afectados?: int}` | Adds the service (enum-validated; enters unconfirmed) + spoken read-back |
| `add_timeline_event` | `{hora: "H:MM"\|"HH:MM", evento}` | Adds a timeline event; hour pattern-validated and read back out loud |
| `add_action_item` | `{descripcion}` | Appends a pending item (one call per item) |
| `set_severity` | `{severidad: enum(low\|medium\|high\|critical)}` | Sets severity exactly as declared — **always** fires a confirmation read-back |
| `send_report` | `{}` | Closes and sends the report (`estado: enviada`) |

The catalog `enum` is the first catch — the agent cannot invent services; the
spoken read-back is the second (the rescue this loop caught in a real session
is in the metrics notes below).

## Metrics

Produced by [metrics/](metrics/README.md) from session artifacts; definitions are
exact and reproducible. **10 REAL voice sessions on the English build,
measured in the final 24 hours** (Voice Incident Reporter, post-visit quiet
dictation, scripted operator, AssemblyAI Voice Agent API; all 10 on interview
prompt v4-en — the English edition of the prompt selected by the Spanish
set's v3→v4 comparison — frozen with zero prompt iterations; **all ten
session artifacts committed as evidence in
[docs/evidence/gate/](docs/evidence/gate/)**, plus the two WP7 gate takes;
the rig is identical to the Spanish-language development set's — same
driver, same seeded ground truth translated with the domain, same oracle):

| Metric | Value | N | Condition |
|---|---|---|---|
| Turn completion (scripted turns transcribed) | 9–11 of 9–11 per session (100%) | 10 sessions | quiet dictation |
| WER, matched pairs (pooled) | **0.685** (0.440–0.845/session) | 2,443 ref words | quiet dictation |
| End-of-speech → tool call, p50 / p95 | 3,031 ms / 3,479 ms | 73 tool turns | real API |
| Severidad exacta | 9/10 sessions | 10 | read-back loop |
| Servicios afectados set precision | 100% (18 TP / 0 FP) | 10 | catalog enum |
| Servicios afectados set recall | 100% (0 FN) | 10 | see notes |
| Timeline horas exactas | 28/35 GT events (80.0%) | 10 | hora exacta; see notes |
| Confirmation-loop precision (read-backs → correction) | 71.0% | 31 read-backs | real dialogue |
| Action items recall | 60.0% (12/20) | 10 sessions | quiet dictation |

*(Spanish row labels are the final form's literal field names — the English
build kept the original field names: severidad = severity, servicios
afectados = affected services, horas exactas = hour-exact entries.)*

*2026-09-30: the tool names cited in these notes were renamed to English after
publication (e.g. `send_report` was `enviar_reporte`); the session artifacts in
[docs/evidence/gate/](docs/evidence/gate/) keep the pre-rename tool names under
which the N=10 table was measured.*

**Barge-in respected** is not measured on the English set (no
designed-interrupt take in the N=10 composition) — the row is omitted rather
than inherited; the Spanish development set measured 0/3 (see its notes
below).

Honest notes: (1) WER 0.685 is dominated by a VAD segmentation artifact, not
hearing — word coverage is 0.85–0.96× of ground truth per session with clean
transcripts; the English wavs' intra-turn pauses split each turn into ~2
transcript hypotheses (17–23 items per session for 9–11 scripted turns, vs
≈1:1 for the Spanish control artifacts), and the greedy matcher pairs one
item per turn, counting the unpaired half as deletions. The split is decided
by the server VAD (threshold 0.4, identical to the Spanish baseline) before
any prompt acts on it; raising the threshold would improve the number and
break protocol identity — declined as metric-gaming. (2) Prompt v4-en was
frozen with zero iterations: every prompt-controlled metric was green at
freeze — turn completion 100%, severity 9/10, services 100/100, timeline
hours 80.0%, confirm precision 71.0% (stop criterion and full rationale in
[STATUS.md](STATUS.md) METRICS-N10-EN). (3) All 10 sessions execute the
report-send tool call (`send_report` (was `enviar_reporte`) — in three of them
a final `set_summary` (was `set_resumen`) follows in the same closing turn);
0 of 10 hit the 300 s driver
watchdog (the Spanish set: 2 of 10 — its close-out race was fixed before
these runs). (4) N08's severity was never set (ground truth: medium) despite
a complete session — agent variance under 8 barge-ins; published as
measured, because re-running to fix it would bias the table. (5) Strict
timeline (hour + event text sim ≥ 0.6) is 0 TP in every session, same policy
and cause as the Spanish set: verbatim agent phrasing vs clean ground-truth
phrases — hour-exact is the reported signal. (6) End-of-speech → tool p50 is
3,031 ms vs 1,554 ms on the Spanish set: the English prompt's few-shots
(hours, multi-fact narrative) lengthen agent turns before the tool call;
documented, no plan target. (7) No re-rolls: every completed run is published
as measured (scenario repeats — i1×3, i2×3, i3×2, i4×2 — stand, which is why
N08's severity miss is in the table); the Spanish set's dedicated run-to-run
variance study was not repeated. (8)
Confirm-precision derivation undercounts rescues when the operator answers
with content instead of yes/no (same as the Spanish set); the
designed-rescue chain was measured separately by the WP7 gate takes
committed alongside — 2/2 takes with ≥1/2 mechanical rescues (prod↔staging
correction; severity medium→high). (9) Barge-in respected is not measured on
the English set — the row is omitted rather than inherited (Spanish
development set: 0/3). (10) Action-items recall (60.0%, 12/20) is a row the
English table adds; the Spanish real-session table does not publish it.

### Development evidence (original Spanish-language build, N=10)

Produced by [metrics/](metrics/README.md) from session artifacts; definitions are
exact and reproducible. **10 REAL voice sessions** (Voice Incident Reporter,
post-visit quiet dictation, scripted operator, AssemblyAI Voice Agent API;
5 sessions on interview prompt v3 + 5 on prompt v4, the narrative-capture fix
documented in [STATUS.md](STATUS.md) METRICS-N10; three sample artifacts plus
one post-audit session are committed as evidence in
[docs/evidence/gate/](docs/evidence/gate/) and the full set stays local.
*(Measured on the original Spanish-language build; see the English-build note
at the top.)*

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
content ("producción") instead of yes/no. (6) No session in the N=10 set
reached `send_report` (was `enviar_reporte`) — post-audit diagnosis found a driver close-out
race: the close loop only waited for already-open replies, and the final
reply (which carries the send) takes ~1.5 s to open, so it died with
`session.end`. The fix in `scripts/realgate.mjs` (cycled close-out: wait for
the reply to open, then drain, repeat) is confirmed by one post-audit run —
R6a, same script and prompt — which completed the arc: 23 tool calls ending
in `send_report` (was `enviar_reporte`), `estado: enviada` in the final form, services 100/100
and severity exact vs ground truth (artifact committed as evidence). R6a is
not added to the N=10 table: the rig changed after the audit.
(7) Aggregate chronological
WER and agent-first-word latency stay excluded as driver artifacts —
matched-pair WER is the reported figure. (8) Designed barge-ins never made
the 500 ms respect window: the hour-correction turn (the one scripted
interrupt, three i3 runs — R3a/R3b/R5c) measured 9,034 / 1,338 / 20,501 ms
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

**Watch (3:44, EN, captions burned):** *link added at submission —
hosted unlisted by the owner; the caption track `demo-video-d6-v5.srt`
(70 cues) ships alongside it and doubles as the closed-captions
upload.* It opens at 7 PM: **Raúl, technician at Uniformes Delta**, has just
closed incident IC-2001 and the report is still unwritten — the demo is his
evening, recovered. Re-recorded on the English UI in the final 24 hours — the numbers
spoken in the video are the re-measured English-build table in the Metrics
section; the development-evidence table above and the companion clip below
are the original Spanish-language build. A 66-second
companion clip of a **real live-API session** is submitted with it:
`real-session-clip-v5.mp4` — the session replayed frame-by-frame from its own
JSON artifact, recorded on the original Spanish-language build. The operator
side is **audible** — the scripted wav track, disclosed in the burned-in
bands; the session itself stored no audio (`audio_retained: false`, and the
server rejects any artifact claiming otherwise). That session (artifact
[committed as evidence](docs/evidence/gate/artifact-i2-servicio-confundido-tranquilo-W7T3.json))
logged **20 user turns, 17 tool calls, 194.8 s of microphone, and 148
timeline events**.

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

Based on the gallery audits of 2026-09-15 and 2026-09-17 (61 → 63 submissions
audited; the dashboard showed 94 live on 2026-09-21, +11 that day;
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
- **Zero of the audited submissions publish measured extraction accuracy**
  (full audits of 2026-09-15 and 2026-09-17, 61 → 63 entries; the 2026-09-21
  dashboard check counted 94 live and a spot-check of the new top-voted
  entries' public blurbs found none publishing it either). The closest is
  Robin Voice Ops, which publishes a
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
> re-audit day) and kept growing to 94 by the 2026-09-21 dashboard check —
> the accuracy claim stays anchored to the two dated full audits, and a
> final count-check lands with the submission itself; evidence with URLs and
> access dates in
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

**Zero npm runtime dependencies** — `package.json` ships no `dependencies`
(Node 22, ESM; static browser app, no build step).

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

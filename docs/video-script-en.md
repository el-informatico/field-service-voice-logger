# Video script v1 (EN) — Voice Incident Reporter

Target: **< 5:00** (4:40 planned). Real numbers from the README metrics table
(N=5 real quiet sessions; full table + honest notes in README §Metrics and
docs/D2-GATE-RESULTS.md for the pivot story).

## BEAT 1 — The pain (0:00–0:20)

**[0:00–0:08] Visual**: phone photo of a technician's crumpled paper notes / a
work-order app with 12 empty fields. VO:
> "Every field visit ends the same way: twenty minutes of paperwork from
> memory, in a truck, after the job. Notes get lost. Reports get thin."

**[0:08–0:20] Visual**: split screen — typing with one hand on a truck hood vs.
SPEAKING. VO:
> "Voice-to-text exists — but dictation alone can't tell a work order from a
> guess. We built the thing that CHECKS what it hears."

## BEAT 2 — Live roleplay: a real incident session (0:20–3:20)

**Setup shot (0:20–0:28)**: browser (mobile layout) on the dashboard → pick
incident **IC-2003 — "corte de red"** → consent screen → session starts.
Caption: "Live session — AssemblyAI Voice Agent API".

**[0:28–1:10] The dictation interview**. Operator (operator VO, natural pace):
> "Va — I'm back in the truck, done at Kimsa. The outage started around
> eight-fifty, reception called — no internet, no IP phones…"

Agent (TTS, audible): captures, asks ONE thing at a time, `agregar_evento_timeline`
fires → UI ficha fills the timeline row live.
> "Event at eight-fifty — reception call. Correct?"

**[1:10–1:50] The read-back loop (THE differentiator)**. Operator mentions
"the production web server". Catalog has PROD ↔ STAGING confusable pair.
Agent asks:
> "Production or staging?"
Operator: "Production — the staging one was fine."
UI: `SRV-WEB-PROD` chip appears with pending badge → operator confirms → ✓.
VO overlay (2s):
> "That question just saved the report. Nobody in this event shows a spoken
> confirmation loop — and nobody publishes what happens when it's missing."

**[1:50–2:30) Numbers spoken aloud**: severity read-back
> "Logging severity HIGH — correct?"
(+action items: "buy a spare switch", "notify the site lead").

**[2:30–3:20] The measured-numbers interlude** (screen: README metrics table,
highlight rows while VO):
> "This is not a demo claim — it's measured. Across five real scripted
> sessions: turn completion eight-to-ten out of ten-eleven. Word error rate on
> matched turns: twenty-three percent. Speech-end to tool call, median 1.8
> seconds. When the interview engaged: services precision one hundred percent,
> timeline three-for-three. And we publish the failures too — two of five
> sessions collapsed; the variance is on the table, because that's the only
> kind of number worth trusting."

## BEAT 3 — The ficha + export (3:20–4:10)

- End screen: full incident card — resumen, qué pasó (verbatim), timeline
  rows, service chips ✓, action items, severity chip.
- Click **CSV** → file downloads (show contents 2s).
- Click **PDF** → print preview (A4 ficha, audit footer "voice session — audio
  not retained").
- Click **Send to FSM** → ack toast `FSM-20260915-xxxxx accepted`.
- VO:
> "Auditable from the first word: every field carries its own trail — which
> tool set it, when, confirmed by voice or edited by hand. Export anywhere."

## BEAT 4 — Architecture + business value (4:10–4:50)

**[4:10–4:26] Diagram** (docs/assets or whiteboard): browser (static, no
build) → mic → one WebSocket `wss://agents.assemblyai.com/v1/ws` → STT+LLM+TTS
+VAD managed; client-side function tools with JSON-Schema enums against the
service catalog; server holds ONLY a one-use temp token — the API key never
reaches the browser; audio never persisted — transcript + tool events only.
> "One managed WebSocket does speech, reasoning and turn-taking. Tools are
> JSON-Schema with catalog enums — that's what catches production-versus-
> staging before the read-back even asks."

**[4:26–4:50] Business value + close**:
> "Field teams spend up to an hour a day writing up visits. A voice report
> with a confirmed read-back takes three minutes and is invoice-grade.
> Relay — the strongest field-ops entry in this event — says it themselves:
> they are NOT a form filler. QuoteReady reads a quote back on the phone.
> We are the documentary layer under all of it: the spoken confirmation loop
> and the published accuracy. Voice in. Evidence out."

**[4:50–5:00 max]** End card: repo URL + "metrics reproducible — clone and run
`npm run smoke:mock`".

## Production notes

- Numbers cited (must match README if table updates): N=5 real sessions;
  turn completion 8–10/10–11; matched-WER 0.231 (0.164–0.382); tool-call
  latency p50 1,775 ms / p95 6,192 ms; services precision 100% / recall 37.5%;
  timeline 3/3 in engaged sessions; severity 2/5; confirmation precision
  61.5% (13 read-backs); 2/5 sessions collapsed — SAY IT, it's the wedge.
- Do NOT name the underlying model (event page model names are stale; the
  Voice Agent API doesn't publish it).
- Roleplay audio: real session (key in `.env`, ~$0.2/take) or deterministic
  mock replay (`scripts/demo-video.sh`) for unlimited takes — label honestly
  on screen which one is shown ("live API session" vs "deterministic replay").

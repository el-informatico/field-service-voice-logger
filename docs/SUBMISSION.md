# Hackathon submission text — AssemblyAI Voice Agent Hackathon (lablab.ai)

Closes 2026-09-30 15:00 UTC. Everything below is copy-paste ready; sources: README.md,
STATUS.md, docs/video-script-en.md, docs/D2-GATE-RESULTS.md,
docs/research/competitor-landscape-2026-09-15.md, docs/GALLERY-AUDIT-0917.md.

## Submission metadata

**Title options** (pick one — justification and recommendation below):

1. **Voice Incident Reporter** — the product's literal name; what the video and the metrics table describe. Safest match to every artifact (video end card, README hero, live UI); a judge going title → repo → video gets one consistent name.
2. **Field Service Voice Logger** — the repo's name; the plainest description of the lane. Costs a rename mismatch: the video end card and the app itself say "Voice Incident Reporter".
3. **The Report That Reads Itself Back** — leads with the differentiator. Most memorable in a 94-entry gallery, but names a feature, not the product; weaker anchor for repo/video cross-checks.

*Recommendation (owner ratifies):* **#1 Voice Incident Reporter** — consistency across submission → repo → video → live demo beats cleverness for judge verification; #3's hook already lives in the tagline.

**Tagline:** Voice in, evidence out — post-visit incident reports with a spoken read-back loop and published accuracy.

**Team handle:** el-informatico

## Short description

A voice agent that interviews the technician after a visit, fills the incident report live via tools, and reads critical values back out loud until the record is provably correct. 10 real measured sessions; accuracy and failures published. Audio never stored.

*(259 characters.)*

## Full description

**The problem**

Field technicians spend 30–60 minutes per job writing up the visit — often after hours, in a truck, from memory. Notes get lost, reports get thin, and nothing is auditable. Voice-to-text exists, but dictation alone cannot tell a report from a guess: "production" and "staging" servers, rack A3 and A8, 3/4" and 3/8" valves all sound close enough to end up on an invoice. Of the submissions we audited — 61 at the 2026-09-15 gallery audit, 63 at the 2026-09-17 re-audit, with the dashboard showing 94 live at our 2026-09-21 check — none published measured extraction accuracy (the closest, Robin Voice Ops, publishes a scenario pass-rate and latency percentiles, not field-level accuracy; spot-checks of the new top-voted entries' blurbs on 09-21 found none either): every voice demo we could find either fills a form or dispatches autonomously; none publish accuracy, and none rescue capture errors by speaking them back.

**What it does**

After the visit, the technician opens the incident and starts a voice session — consent screen first, microphone second. The agent interviews them: one thing at a time, built for long working pauses and barge-in. Every statement becomes a client-side tool call defined with JSON Schema, so the incident card (the "ficha") fills live on screen, each field carrying its own audit trail (which tool set it, when, confirmed by voice or edited by hand). Critical values — services, severity, timeline hours — are read back out loud and confirmed before they count. Confusable services are caught twice: by the catalog `enum` in the schema, and by the spoken loop. When the session ends, the record leaves as evidence: CSV for the ticket system, a print-ready PDF whose audit footer states audio was never retained, and a JSON timeline artifact that powers replay and metrics. Raw audio is discarded by design — the server actively rejects any artifact that claims otherwise.

**How we built it**

- **AssemblyAI Voice Agent API over a raw WebSocket** — we verified the contract from the official docs (one-use temp token, PCM16 24 kHz audio as base64-in-JSON, string tool results, explicit session end) and wrote the client ourselves; there is no official web SDK.
- **Client-side JSON-Schema tools** with catalog `enum`s — the agent can only pick services that exist; the wrong entry is rejected before the read-back even asks.
- **Zero npm runtime dependencies**, Node 22, static browser app with no build step. A DOM-free session engine is shared between browser and Node, which is what makes the pipeline CI-able.
- **Vercel serverless**: one endpoint issues single-use temp tokens (the API key never reaches the browser); another stores transcript + tool state, never audio.
- **A deterministic mock channel with the same interface** drives CI (`npm run selftest`, `npm run smoke:mock`): identical artifacts run-to-run, exact match against seeded ground truth (precision/recall 100% across services, timeline, action items, severity), seeded capture errors rescued, WER 0.006 — no API key, no cost, no recorded humans.
- **A metrics harness with a hand-computed oracle**, plus a real-session driver (`scripts/realgate.mjs`) that runs scripted operator utterances at natural pace against the live API with seeded ground truth per script. The N=10 aggregator (`scripts/n10-table.mjs`) was validated by reproducing the earlier published N=5 table exactly before use. The incident domain itself was the pivot product: ~70% of the code (WebSocket channel, engine, artifact, metrics, export) is shared with the original work-order variant, which remains in the repo.

**Honest rig & framing**

- **All published metrics come from 10 real voice sessions against the live AssemblyAI API**, driven by a rules-only measurement rig: scripted operator utterances (pre-generated wav played at real pace), seeded ground truth, no free-form human turns. The rig is why the numbers are reproducible — and why we do not claim spontaneous-conversation performance.
- **The demo video's roleplay beats are a deterministic replay of the mock channel.** The burned on-screen label says so: "DETERMINISTIC REPLAY — scripted session (mock channel)" — and the narration says it out loud too ("What you're watching is a deterministic replay — the scripted session on a mock channel, in the operator's Spanish UI. The numbers later come from real API runs."). The narration is synthetic text-to-speech made for the video. We never present synthesized audio as the assistant's real session audio — real-session evidence lives in the per-session artifacts and the metrics table, not in acting. (The video was re-rendered 2026-09-16 against the N=10 table below — on-screen values and spoken numbers match the README verbatim.)
- **The noise-gate pivot was an evidence-driven decision, not a hidden failure.** The original plan — live voice during the repair — went through a pre-registered gate at 10 dB SNR with DEMAND noise (16 real sessions, runbook in docs/D2-GATE.md, results in docs/D2-GATE-RESULTS.md). Clean audio converged (WER 0.080, ground-truth-exact card). At 10 dB, every pre-registered criterion failed: false turn-endings 2–4 per session (criterion ≤1), provoked barge-ins 1/3 and 0/3 (criterion ≥2/3), WER 0.17–0.25 in babble, tool calls collapsing from 7 to 0–2; `voice_focus: near-field` did not help. Gate failed → we pivoted to post-visit quiet dictation and designed the failure mode out, keeping the read-back loop and the published numbers.
- **The live deployment runs the deterministic mock channel** (no API key on the public server, by design). Real sessions run locally against the live API with a one-use token.

**Challenges we ran into**

- **Industrial noise beat the live-during-repair route** — see the gate above. The honest response was to change the product's environment, not the demo's audio.
- **The narrative script collapsed under interview prompt v3**: continuous dictation (no pauses, no markers) ended in 1 tool call and 0/8 timeline hours, twice in a row. Prompt v4 fixed it — a "registrar" reframe with one rule set: no spoken datum goes unregistered, one tool call per datum, read-back grouped at the close, hour-conversion few-shots ("eight fifty" → 8:50). Same scripts, same conditions: services recall 37.5% → 100%, hour-exact timeline 35.3% → 72.2%, severity 2/5 → 4/5, end-of-speech→tool p50 1,775 → 1,139 ms. A v5 attempt (three targeted edits) regressed in its only measured run — read-backs spoken without tool calls — and was fully reverted; the two-iteration budget was pre-registered and exhausted, so v4 is final and the variance is documented rather than iterated away.
- **WER 0.231 on matched pairs** — roughly one word in four. That is the real hearing number and it is not hidden; it is the reason the product is a confirmation loop and not a transcriber.
- **A harness bug caught in integration**: mock sessions reported 90% WER because references were paired by global script index against user-turn index; chronological pairing took it to 0.003. The oracle-first harness found its own bug.
- **Rig limits**: the 300 s driver watchdog truncated 2 of 10 sessions, and no session in the N=10 set reached `enviar_reporte` — post-audit, that proved to be a driver close-out race (fixed in the rig), not an agent limitation: one post-fix session completed the send (see notes under Metrics).

**Accomplishments**

- **10 real, measured, published sessions — failures included.** Turn completion, WER, latency percentiles, per-field precision/recall, confirmation-loop precision: all on the table, reproducible from the repo, with four session artifacts committed as evidence (docs/evidence/gate/ — three samples from the N=10 set plus the post-audit send-completion session). Zero of the audited gallery submissions published measured extraction accuracy (61 at the 2026-09-15 audit, 63 at the 09-17 re-audit; 94 live at the 09-21 dashboard check, spot-checked).
- **The seeded capture error was rescued by the spoken loop in a real session** (rack A8 captured → disambiguation read-back naming both catalog services → A3 confirmed; recorded in the session artifact).
- **A measured prompt fix, not a vibe**: the v3→v4 comparison above was run on the same scripts under the same conditions, and the pure-narrative script went from 1 tool call and 0/8 hours to 10–15 tool calls and 7/8 hours.
- **CI-proven end-to-end**: one command (`npm run smoke:mock`) runs sessions, artifacts, and the metrics table deterministically with zero dependencies and zero API cost.
- **Privacy enforced in code, not in a policy page**: consent before the mic, audio never uploaded, and the server rejects any artifact with `audio_retained ≠ false` or audio-typed payloads (33 backend self-checks).
- **Evidence-linked differentiation**: two dated gallery audits with cited quotes (docs/research/competitor-landscape-2026-09-15.md, docs/GALLERY-AUDIT-0917.md); the previously unverifiable field-service-adjacent entry (KiaOra Dispatch) is now verified as dispatch-intake with no published accuracy, and competitor quotes were re-checked verbatim on 2026-09-17.

**What's next**

- Durable storage for the session and report endpoints (currently explicitly ephemeral; the swap point is documented).
- The "confirmation + new data in one turn" pattern ("yes, that's right — and leave two pending items"): action items went 0/2 in two sessions because the confirmation rule swallowed the new data. This was v5's target and remains open.
- Reducing the residual run-to-run variance of the interview agent (v4 mitigates; one v4 session still spoke read-backs without registering the timeline).
- A verbatim-vs-normalized capture policy for free text, and mobile/headset validation of the live session UI.

## Metrics (N=10 real sessions)

10 real voice sessions: Voice Incident Reporter, post-visit quiet dictation, scripted operator, AssemblyAI Voice Agent API. 5 sessions on interview prompt v3 + 5 on prompt v4 (the narrative-capture fix documented in STATUS.md, METRICS-N10). Produced by `metrics/` from per-session artifacts (three committed as evidence in docs/evidence/gate/ plus one post-audit session, the full set local); definitions are exact and reproducible.

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

*(Spanish row labels are the artifact's literal field names: severidad = severity, servicios afectados = affected services, horas exactas = hour-exact entries.)*

**v3 vs v4, same scripts and conditions.** Prompt-v4 sessions alone: service set precision/recall 100%/100% (9 TP / 0 FP / 0 FN), hour-exact timeline 13/18 (72.2%), severity 4/5, end-of-speech→tool p50 1,139 ms — versus 37.5% recall, 35.3% timeline hours, 2/5 severity, and 1,775 ms for the v3 half (v3 p95 6,192 ms vs 3,726 ms; confirmation precision 61.5% over 13 read-backs vs 62.5% over 16). WER is 0.231 in both halves: the fix changed tool-call discipline, not hearing. The pure-narrative script that collapsed to 1 tool call under v3 now registers 10–15 tool calls and 7/8 timeline hours across its two v4 sessions.

**Honest notes (compressed; full list in README §Metrics):**

- WER 0.231 is the headline hearing number and is not hidden — it is why the read-back loop exists.
- Run-to-run variance of the interview agent persists: one v4 session (R5b) spoke read-backs without registering the timeline (0/3 hours). v4 mitigates; it does not eliminate.
- 2 of 10 sessions (R2a, R5b) hit the 300 s driver watchdog and lost their final turns — R5b's severity miss was the correction turn that never played.
- Strict timeline match (hour + event text similarity) is 0 TP in every session: the agent captures the operator's verbatim phrasing while the ground truth stores clean phrases — hour-exact match is the reported signal.
- No session (v3 or v4) in the N=10 set reached `enviar_reporte`: the rig's close-out only waited for already-open replies, and the final reply — the one carrying the send — takes ~1.5 s to open, so it died with `session.end` (9 of 15 artifacts end with an empty final agent turn). Diagnosed post-audit and fixed in `scripts/realgate.mjs`; one post-fix run (R6a, same script i1 and prompt v4, committed as evidence) completed the arc — 23 tool calls ending in `enviar_reporte`, `estado: enviada`, services 100/100 and severity exact vs ground truth, timeline 3/4 hour-exact. R6a is not added to the N=10 table: the rig changed after the audit.
- Turn-completion misses are VAD splits of long turns and empty final transcripts (driver artifacts), not agent refusals; rescue counts undercount when the operator answers with content ("Producción") instead of yes/no.
- Designed barge-ins never made the 500 ms respect window: the hour-correction turn (the one scripted interrupt, three i3 runs — R3a/R3b/R5c) measured 9,034 / 1,338 / 20,501 ms speech-start → reply-cut with `interrupt_response: true, interruption_delay: 0` configured throughout; 25 further opportunistic `barge_in` events carry no timing anchor and are excluded by the canonical metric (metrics/lib/bargein.js). Same C3 weakness that failed the work-order D2 gate and drove the pivot to quiet post-visit dictation with a spoken confirmation loop.

## Built with

- **AssemblyAI Voice Agent API** — raw WebSocket client, no SDK (none exists for the web).
- **Client-side JSON-Schema tools** — function-calling schemas with catalog `enum`s defined in the browser.
- **Node 22** — ESM throughout.
- **Zero npm runtime dependencies** — static app, no build step; the whole stack is the platform plus our code.
- **Vercel serverless** — one-use temp tokens and session storage; API key never leaves the server.
- **Deterministic mock channel for CI** — same interface as the real channel, identical artifacts run-to-run.
- **edge-tts** — voice-over for the demo video narration only (never presented as session audio).

## Links

- **GitHub:** https://github.com/el-informatico/field-service-voice-logger
- **Live demo:** https://field-service-voice-logger.vercel.app (runs the deterministic mock channel — no API key on the public server, by design)
- **Demo video (3:00, EN, captions burned):** <link at submission time — owner hosts unlisted; file `demo-video-d6.mp4` — identical to `aai-demo-final.mp4`, reconciled 2026-09-23 — plus `demo-video-d6.srt` (56 cues, cued to this master). Pre-upload check: `sha256sum demo-video-d6.mp4` must start `d1f7bc04ec2a27b9` (the audited 8.85 final; anything starting `31420938…` is the older 8.80 iteration)>
- **Real-session clip (0:55, silent by design, disclosure bands burned):** <link at submission time — owner hosts unlisted; file real-session-clip.mp4>
- **Slide deck (PDF, required field):** https://github.com/el-informatico/field-service-voice-logger/blob/main/docs/deck/voice-incident-reporter-deck.pdf — 11 slides, 16:9, EN, shipped in the repo (`docs/deck/`, source `deck.html`, rebuild notes in its README); a copy lives with the owner's deliverables. *(Verify the raw view renders after the push: `raw.githubusercontent.com/…/main/docs/deck/voice-incident-reporter-deck.pdf`.)*

## Platform mapping

These sections map 1:1 to Devpost-style fields: metadata → title/tagline/team, Short description → the card blurb (≤280 chars), Full description → the long description, Metrics → append to the description, Built with → the tech list, Links → link fields. For lablab.ai's single description field, paste **Short description + Full description + Metrics** in that order; put the repo, video, live-demo, and slide-deck URLs in the dedicated fields (the deck is REQUIRED — build `voice-incident-reporter-deck.pdf` before submitting).

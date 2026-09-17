# Gallery re-audit — AssemblyAI Voice Agent Hackathon (2026-09-17)

Pre-submit re-audit of the claims that depend on the live gallery: submission
count, Relay/QuoteReady competitor quotes, and the "nobody publishes measured
extraction accuracy" differentiator. Baseline:
[competitor-landscape-2026-09-15.md](research/competitor-landscape-2026-09-15.md)
(61 submissions). All pages accessed **2026-09-17** via `tavily` extract
(succeeded where `mcp__fetch__fetch` returns the JS shell; AutoCopilot and
Benchback app pages still render empty — noted below).

## 1. Event state (judge-day truth)

Source: <https://lablab.ai/ai-hackathons/assemblyai-voice-agent-hackathon/live>
(accessed 2026-09-17) — status "Live · Submissions open", Sep 1–30 2026,
$10,000 prize pool ($5k cash + $5k AAI credits).

| Metric | 2026-09-15 | 2026-09-17 | Δ |
|---|---|---|---|
| Submissions | 61 | **63** | +2 |
| Participants | 3,053 | 3,084 | +31 |
| Teams | 831 | 841 | +10 |
| Drafts in progress | 45 | 45 | 0 |

Anomaly noted honestly: the dashboard flagged "▲ +8 today" on submissions while
the total moved only 61→63 over two days — either removals/moderation or
intra-day counting; we report the total (63), not the daily delta. Community
vote counts on the top-10 also dropped sharply between audits (e.g. SAUTI AI
110→11) — consistent with a vote reset near the deadline; recorded as an
observation, no claim depends on it. Top-10 ordering is otherwise unchanged
(SAUTI, Siberia, KiaOra, MockMate, EchoExaminer lead).

## 2. Competitor quote re-verification

### Relay — quote HOLDS verbatim

<https://lablab.ai/ai-hackathons/assemblyai-voice-agent-hackathon/relay/relay-voice-operations-for-field-work>
(accessed 2026-09-17; page created 2026-09-02, unchanged since the 09-15 audit):

> "Relay is not a voice form filler. It is a voice operations agent that
> executes work, handles exceptions, and proves every outcome. Speak once.
> Keep moving."

Still zero metrics on the page, still no read-back of captured data ("proves
every outcome" = workflow outcomes), still no PDF/CSV export. The 09-15
checklist verdicts all carry over. (Cosmetic: the tech tag shown is now
"AI/ML API"; tool listed remains Vercel.)

### QuoteReady — quote HOLDS verbatim

<https://lablab.ai/ai-hackathons/assemblyai-voice-agent-hackathon/quoteready/quoteready>
(accessed 2026-09-17; page created 2026-09-08):

> "Broader real-speaker and interruption evaluation is still future work."

Still no accuracy figures (functional test narrative only: 5 fields, 1
correction, 64 s recording, "All 26 affected local tests passed"), still
JSON-only export. Bonus — the 09-15 audit's "orphan snippet" (a home-service
intake description DDG had mis-attributed to Radio Universe) is now
attributed: it is QuoteReady's own app-directory blurb ("A voice intake
assistant that turns vague home-service enquiries into reviewable request
drafts…"). No third hidden evidence-lane entry; mystery closed.

### KiaOra Dispatch — NOW VERIFIED (was unverifiable at 09-15)

<https://lablab.ai/ai-hackathons/assemblyai-voice-agent-hackathon/shinydatatech/kiaora-dispatch>
(accessed 2026-09-17; page created 2026-09-01; #3 by community vote both
audits): NZ property-maintenance **emergency dispatch** — fields inbound
tenant calls 24/7 ("full barge-in support"), classifies P1/P2/P3 statutory
priority tiers, executes `dispatch_work_order` to contractor/webhook
endpoints. Cost ("$35 to under $0.45 per call") and latency ("hours down to
seconds") appear as marketing claims, not measurements. **No measured
extraction accuracy; no post-visit documentation lane; no read-back of
captured values.** Adjacency: property maintenance is field-service-adjacent,
but KiaOra sits on the intake/dispatch side — the collision risk flagged at
09-15 does not materialize.

### AutoCopilot — STILL unverifiable

<https://lablab.ai/ai-hackathons/assemblyai-voice-agent-hackathon/phantom-grid/autocopilot>
returns the empty JS shell under tavily (as under all three methods at 09-15).
Fleet-technician diagnostic copilot per the indexed snippet; no page text to
check. Risk unchanged and bounded: even if it documents repairs, it would need
*published accuracy numbers* to touch the differentiator — none surface
anywhere in the gallery (§3).

## 3. New evidence-lane / measurement-lane entries since 09-15

The gallery's measurement culture is rising — this is the most important
change of the re-audit. None of the entries below publishes **extraction
accuracy** (field-level precision/recall vs ground truth, WER), but one now
publishes latency percentiles, so the differentiator wording must be precise.

| Entry (team, created) | URL (accessed 2026-09-17) | What it publishes | Verdict vs our claim |
|---|---|---|---|
| **Robin Voice Ops** (Sep 15) | [/robin-voice-ops/robin-voice-ops](https://lablab.ai/ai-hackathons/assemblyai-voice-agent-hackathon/robin-voice-ops/robin-voice-ops) | "Measured on the live AssemblyAI API: 6/6 voice scenarios passing, p50 decision latency 1.81s, p95 3.77s; 25/25 offline tests" + SHA-256 hash-chained audit log, human approval queue, semantic turn-taking w/ barge-in | **Closest yet.** Home-services booking/dispatch ops (Relay lane). Scenario pass-rate + latency percentiles — NOT extraction accuracy, no WER, no per-field P/R, no confirmation-loop precision. Claim survives **sharpened**: we are no longer the only submission with published latency p50/p95. |
| **The claim intake agent that refuses to guess** (Sadi Shihab, vector-forge) | [/vector-forge/the-claim-intake-agent-that-refuses-to-guess](https://lablab.ai/ai-hackathons/assemblyai-voice-agent-hackathon/vector-forge/the-claim-intake-agent-that-refuses-to-guess) | Insurance claim intake with server-side validator; read-back on "Unconfirmed" verdicts; discloses measured null experiments (3 recognizer fixes vs the same 4 policy numbers) and a recognizer-biasing failure that manufactured false accepts | Read-back pattern now in **insurance** (was: quotes, OR, farming, DevOps). Publishes failure narratives, not accuracy figures. Domain ≠ post-visit repair record. |
| **Voxrede** (Sep 10) | [/voxrede/voxrede](https://lablab.ai/ai-hackathons/assemblyai-voice-agent-hackathon/voxrede/voxrede) | Voice-agent **red-teaming** on controlled fixtures; findings linked to events/timestamps; "2 of 6 baseline samples contained findings… 5 findings became zero… This is a small comparison, not a reliable fix rate" | Evaluation-lane (tests voice agents, doesn't fill records). Fixture counts only; explicitly disclaims reliability. No extraction accuracy. |
| **Second Listen** (Blink, Sep 10) | [/blink/second-listen](https://lablab.ai/ai-hackathons/assemblyai-voice-agent-hackathon/blink/second-listen) | Investor debrief agent; every signal recorded with the investor's own quote + capture moment; ledger of follow-ups | Evidence-linked capture now in **VC/investment**. No accuracy numbers. |
| **Uh-Huh: A Voice Agent for Busy-Handed Workers** (Gnomon) | [/gnomon/uh-huh-a-voice-agent-for-busy-handed-workers](https://lablab.ai/ai-hackathons/assemblyai-voice-agent-hackathon/gnomon/uh-huh-a-voice-agent-for-busy-handed-workers) | Worker-side inbound-call handling; one-syllable confirm ("Sink job, Tuesday 3pm — good?" → "uh-huh"); hand-built lexicon with declared misses; demo caller pre-recorded (disclosed) | Field-service-adjacent (the worker's ear), micro-read-back of a proposed booking — but no work-order artifact, no audit trail, no export, no metrics. |
| **Benchback: From parts shelf to paid back** | app-page URL still renders empty JS shell (same class as AutoCopilot); description via lablab /apps directory + sidebars | "voice-operated core-deposit desk for repair shops… human approval at every financial step" | Repair-shops domain (closest vocabulary to ours), approval at financial steps ≠ read-back of captured data; no metrics visible in any indexed text. Page unfetchable → unverifiable, noted. |

## 4. Verdict — do the claims survive?

1. **"Zero of N submissions publish measured extraction accuracy" — HOLDS at
   N=63**, with sharpened wording: Robin Voice Ops publishes a scenario
   pass-rate and decision-latency percentiles (cited above), so the claim must
   name what is still absent everywhere — **extraction accuracy vs ground
   truth (per-field precision/recall, WER) and confirmation-loop
   precision/recall**. Updated in README and SUBMISSION.md accordingly.
2. **Relay and QuoteReady quotes** — verbatim-still on 2026-09-17; all
   checklist verdicts from 09-15 carry over.
3. **The wedge** (post-visit field-service record + published extraction
   accuracy + spoken confirmation loop) — still unclaimed. The
   evidence-linked/read-back pattern keeps crowding into new verticals
   (+insurance, +investment since 09-15), which strengthens, not weakens, the
   "we don't claim the pattern — we claim the domain plus the published
   numbers" framing.
4. **Residual risks**: AutoCopilot and Benchback pages unfetchable (both
   noted, neither shows accuracy claims in any indexed text); gallery moved
   +2 in two days — one final count-check on submission day (28-sep margin)
   is the last human step.

## 5. Claims refreshed by this audit

| File:line (before edit) | Old | New |
|---|---|---|
| README.md:15 | "pre-sprint scaffold — real voice sessions start D1" | current state: 10 real sessions, metrics published |
| README.md:24 | "this hackathon's 61 submissions" | "63 submissions" |
| README.md:121–122 | "gallery audit of 2026-09-15 (61 submissions…)" | both audits, 61→63, link here |
| README.md:132 | Relay "as of 2026-09-15" | re-verified 2026-09-17 |
| README.md:134 | "Zero of 61…" | "Zero of 63…" + Robin-sharpened wording |
| README.md:135–136 | crowding list (3 verticals) | + insurance claim intake, investor debriefs |
| README.md:145–148 | "AutoCopilot and KiaOra… could not be verified" | KiaOra verified (dispatch, no accuracy); AutoCopilot still unverifiable; +8/day pace; link here |
| docs/SUBMISSION.md:29 | "Of the 61 submissions live at our 2026-09-15 gallery audit…" | 61→63 across both audits + Robin caveat |
| docs/SUBMISSION.md:61 | "Zero of 61 … at audit time" | "Zero of 63 … at the 2026-09-17 re-audit" |
| docs/SUBMISSION.md:66 | "a dated gallery audit" | "two dated gallery audits" (links both) |

Metrics table (N=10): untouched, frozen — this audit changes market claims
only.

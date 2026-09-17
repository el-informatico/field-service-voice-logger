# RESUME — pre-submit evidence session (2026-09-17)

Session: T-AAI-1 / T-AAI-2 / T-AAI-4 from the internal judge-audit report,
§P1 (local workspace path redacted per CONTRIBUTING token policy).
Rules: local commits only, NO push; don't touch video-d6-work/, skill dir,
other projects. Deadline: submit closes 30-sep 15:00 UTC (internal 28-sep).

## ✅ Checkpoint 1 — T-AAI-1 gallery re-audit + claims refresh (DONE 2026-09-17)

Evidence: `docs/GALLERY-AUDIT-0917.md` (all URLs + access dates). Headlines:

- Count **61 → 63** (dashboard /live, 09-17; 3,084 participants, 841 teams,
  45 drafts; "Live · Submissions open"; +8 flagged on re-audit day, net +2 —
  anomaly noted in doc; top-10 votes apparently reset — observation only).
- Relay quote holds verbatim; QuoteReady quote holds verbatim; the 09-15
  "orphan snippet" resolved (it was QuoteReady's own /apps blurb).
- **KiaOra Dispatch NOW VERIFIED**: NZ property-maintenance emergency dispatch
  (intake side), publishes no accuracy → collision risk retired.
- **AutoCopilot still unverifiable** (JS shell, all methods).
- **Robin Voice Ops (new since 09-15)** publishes "6/6 voice scenarios passing,
  p50 decision latency 1.81s, p95 3.77s; 25/25 offline tests" → closest entry
  yet, but scenario pass-rate + latency ≠ extraction accuracy. Claim sharpened
  accordingly (we are no longer the only submission with published p50/p95
  latency; we remain the only one with field-level accuracy/WER/
  confirmation-loop precision).
- Other new entries catalogued: claim-intake agent (insurance read-back),
  Voxrede (red-teaming), Second Listen (investor debriefs), Uh-Huh
  (busy-handed workers), Benchback (snippet-only).

Claims refreshed:

- `README.md` — status line (was "pre-sprint scaffold"), :24 count, audit
  reference (both audits), Relay re-verified date, "Zero of 63" + Robin
  sharpening, crowding list (+insurance, +investor), caveat block (KiaOra
  verified / AutoCopilot not / final count-check at submit).
- `docs/SUBMISSION.md` — sources line, full-description count sentence,
  accomplishments "Zero of 63", evidence-linked bullet (two audits).
- `STATUS.md` — PASO 0 row (Spanish, re-audit results).
- Metrics table: UNTOUCHED (frozen, N=10).

## ⚠️ Entanglement — read before committing anything

A sibling session (video d6) left uncommitted hunks in **STATUS.md,
docs/SUBMISSION-CHECKLIST.md, docs/SUBMISSION.md, docs/VIDEO-REVIEW-GUIDE.md**
that reference the SUPERSEDED 178.1 s / 2:58 master. The CURRENT master is
**180.2 s (3:00), sha256 prefix `60f71f8e`** (full sha recorded in
`~/projects/field-service-voice-logger-deliverables/VIDEO-AUDIT-d6.md`)
(round 3, 2026-09-17 09:21, `~/projects/field-service-voice-logger-deliverables/demo-video-d6.mp4`).

- My T-AAI-1 edits to SUBMISSION.md (:5, :29, :61, :66) and STATUS.md (:10)
  are **in the working tree, intentionally uncommitted** — they are correct
  and copy-paste-critical for submission; the video session (or the human)
  should commit them together with its own doc updates, ideally after
  refreshing the 2:58→3:00 references in those same files.
- NEVER `git add` those four files as part of an evidence-session commit.

## ⏳ Remaining tasks

- **T-AAI-2** — real-session clip 45–60 s vs live API → deliverables/
  `real-session-clip.mp4` + `REAL-SESSION-NOTES.md`. Harness:
  `scripts/realgate.mjs` (+ `npm run smoke:mock` for the UI). Key: `.env`
  (mode 600), NEVER print/commit. If key missing → STOP + document human gate.
- **T-AAI-4** — barge-in real-session row from `.data/gate/artifact-i*.json`
  (+ D2-gate artifacts) → README §Metrics + SUBMISSION.md table, or honest
  omission note.
- Final: update this file per sub-task; 6-line closing summary.

## Repo facts a sibling session needs

- Live deployment runs mock channel by design (no API key on Vercel).
- `npm run selftest` / `npm run smoke:mock` green as of the judge audit (09-17).
- Push is HUMAN-gated (checklist) — this session does not push.
- Video rounds are CLOSED 3/3 at 8.65 (`VIDEO-ITERATION-STATE.md`) — do not
  reopen T-AAI-3.

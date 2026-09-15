# D2 GATE — Turn-taking under background noise (runbook)

**Read this the moment the AssemblyAI API key lands.** The D2 gate decides the
route: if turn-taking (VAD / barge-in) does not converge with background noise,
we stop investing in the voice logger and pivot to **Plan B** the same day.
Everything below is prepared to run with zero further setup work.

---

## 0. TL;DR decision box

```
1. Put the key in .env (ASSEMBLYAI_API_KEY=...)  -> mode flips to real.
2. Clean baseline: 3 sessions (s1/s2/s3) with the CLEAN tts wavs.
3. 10 dB screening: 3 sessions (s1 x 3 noise scenarios) with the NOISY wavs.
4. Parameter sweep at 10 dB (s1, worst noise): up to 6 trials, order below.
5. Confirmatory at winner: s2 + s3 at 10 dB, 2 runs each.
6. Score every session with metrics/cli.js (commands in §6).
   PASS on all four criteria -> D2 PASSED, proceed to D3.
   FAIL at every setting at 10 dB               -> GATE FAILED -> Plan B (§8).
Budget: ~14-16 sessions x ~7 min x $4.50/h ≈ $8-10 (inside the $50 credit).
```

## 1. Status BEFORE the key (what is ready / what blocks)

Generated and verified 2026-09-15 (pre-sprint). `.data/` is gitignored; total
~176 MB on disk.

| Thing | State |
|---|---|
| TTS of every scripted user turn (voice es-MX-JorgeNeural, 24 kHz mono PCM16 — the session audio format) | READY — 29 wavs, 286 s of speech: `.data/tts/<scenario>/turn-<n>.wav` + per-scenario `manifest.json` (text + duration per file; s2 turn 5 also has the `turn-05-as-heard.wav` seeded-error variant) |
| DEMAND noise (Zenodo record 1227121), ch01 of 16, 300 s per scenario, resampled 24 kHz mono (DKITCHEN, SPSQUARE, OOFFICE) | READY — `.data/noise/<scen>/noise-24k.wav` + `source.json` (zip md5 + consolidated-wav md5) + `.data/noise/manifest.json`. All three are REAL DEMAND (no placeholders) |
| Noise mixes: 29 turns x 3 noises x SNR {10,5,0} dB | READY — 261 wavs, `.data/noisy/<guion>/<noise>/<snr>db/`, one `manifest.json` per dir. Post-mix validation: **0/261 entries outside ±1.5 dB** (worst combo mean |dev| = 0.09 dB; e.g. s1/DKITCHEN/10 dB: mean |dev| 0.03 dB; max peak across all 261 mixes −0.3 dBFS — no clipping) |
| Metrics harness, GT pairing by `scenario_id` | READY (`npm run selftest` green) |
| Regenerate any of the above | `node scripts/tts-synth.mjs`, `bash scripts/fetch-noise.sh`, `node scripts/noise-mix.mjs` (details §9) |
| **BLOCKER** | **The API key, nothing else.** No code changes required for the gate. |

If `.data/noise/*/source.json` says `"placeholder": true`, Zenodo was down when
the material was generated: the mixing pipeline is still testable but the 10 dB
results are NOT field-representative. Re-run `bash scripts/fetch-noise.sh`
(then `node scripts/noise-mix.mjs --force`) before trusting a FAIL verdict.

## 2. Precondition — the key, and how to verify the flip

1. `cp .env.example .env` and set `ASSEMBLYAI_API_KEY=<key>`. The key is read
   server-side only (`api/token.js`); it never reaches the browser.
2. `npm run dev` -> http://[::1]:3000 (WSL2 mirrored networking: use `[::1]`,
   not 127.0.0.1).
3. Verify the flip WITHOUT opening the mic:
   `curl -s http://[::1]:3000/api/token` must answer `"mode": "real"`.
   If it answers `"mode": "mock"`, `.env` is not being read — fix before
   burning time on sessions (mock sessions are useless for this gate).

## 3. Physical setup for the gate sessions

The gate is REAL WebSocket audio (mic -> `input.audio` PCM16 24 kHz). Feeding
the session engine with pre-written transcripts from the noisy condition is
**NOT the gate** — that path exists only in mock mode for CI.

**Rig (fixed for the whole gate, ~10 min to set up once):**

- Laptop + external speakers (or the laptop's own) at a **fixed volume — lock
  it after calibration and never touch it again**. Speakers ~0.5–1 m from the
  mic, pointed at it.
- Headset mic (the D5 target rig), ~2–3 cm from the mouth. Same mic for every
  session.
- Playback: a simple player (e.g. `ffplay`/VLC) playing the turn wavs **in
  guion order, one file at a time, each AFTER the agent finishes speaking**
  (the UI bubble stops growing). For s3's scripted interruptions (turns 7, 15,
  17: `interrupt: true` in the guion) start the wav **on top of the agent's
  speech**, the moment its turn starts — that is the provoked barge-in.
- Calibration (once): play `.data/tts/s1-happy-path/turn-01.wav` at your chosen
  volume and run a throwaway session; the live transcript must track the text
  comfortably. Then LOCK the volume. If volume must change later, redo every
  10 dB condition from scratch.
- Why this works: our client opens the mic with
  `echoCancellation: true, noiseSuppression: false, autoGainControl: false`
  (`web/js/ws-agent.js`). Echo cancellation kills the speaker bleed of the
  AGENT's voice; noise suppression is OFF on purpose so the DEMAND noise
  actually reaches the VAD/STT — that is the stress test.

**Conditions:** `clean` (play `.data/tts/<scenario>/turn-<n>.wav`) and
`10 dB` (play `.data/noisy/<scenario>/<noise>/10db/turn-<n>.wav`). 5/0 dB mixes
exist for the D4 WER curve but are NOT part of the pass/fail gate.

Per condition: **2 sessions per guion** (one operator, back-to-back) — the
second run catches flukes.

## 4. Procedure per session

1. Set the trial's parameters (§5) and **refresh the page** (the config is
   browser-side; no server restart).
2. Consent screen -> order: **OT-1004** for s1, **OT-1003** for s2,
   **OT-1005** for s3 -> pick the matching scenario -> start session.
3. Play the turn wavs in guion order (§3). Interact with the agent's questions
   only through the scripted turns — improvise nothing.
4. End the session **with the UI's "Terminar sesión" button** (it sends `session.end`;
   billing stops immediately — $4.50/h runs on wall time, a forgotten open WS
   keeps charging through the 30 s grace window).
5. The artifact auto-downloads (`sess_*.json`) and POSTs to
   `/api/sessions` (stored under `.data/sessions/`).
6. Rename + tag the artifact into the gate folder:
   ```bash
   mkdir -p .data/gate
   mv ~/Downloads/sess_20260924*.json \
      .data/gate/s1-happy-path__DKITCHEN-10db__vad040__id-def__balanced__r1.json
   # then stamp the real condition (the guion stamps "clean"):
   node -e "const f=process.argv[1],a=require('./'+f);a.noise_condition='demand_dkitchen_10db';require('fs').writeFileSync(f,JSON.stringify(a,null,2)+'\n')" \
      .data/gate/s1-happy-path__DKITCHEN-10db__vad040__id-def__balanced__r1.json
   ```
   Naming: `<scenario>__<noise>-<snr>db__vad<040|030|050>__id<def|0|200>__<balanced|max_accuracy>__r<#>.json`
7. Score it (§6) and fill one row of the table (§7) BEFORE the next session —
   a row that cannot be filled is a signal itself.

## 5. Parameter matrix and trial order

Knobs (verified names, `session.input.turn_detection` / `session.input` — see
`docs/research/assemblyai-notes.md`): `vad_threshold` (0.0–1.0, lower = more
sensitive), `interruption_delay` (ms, 0–1000; default depends on
transcription_mode: 0 in min_latency, 500 in balanced/max_accuracy),
`transcription_mode` (`balanced` default | `max_accuracy` = waits longer,
better for pauses while the tech works). **Do NOT set `min_silence` /
`max_silence`** — they are adaptive by default and pinning them kills the
adaptive pacing (official warning); only touch them in a controlled
last-resort experiment.

Edit `web/js/agent-config.js` per trial, then refresh the page:

```js
  turn_detection: {
    vad_threshold: 0.4,          // trial knob: 0.3 | 0.4 | 0.5
    interrupt_response: true,    // barge-in on (default; keep true always)
    interruption_delay: 0,       // trial knob: omit line = server default | 0 | 200
  },
  input: {
    ...,                         // keyterms etc. stay as-is
    transcription_mode: 'balanced', // trial knob: 'balanced' | 'max_accuracy'
  },
```

**Trial order (1 session each; early-exit allowed — see below):**

| # | Condition | vad | interruption_delay | mode | Guion / noise | Purpose |
|---|---|---|---|---|---|---|
| T0a–c | clean | 0.4 | default | balanced | s1, s2, s3 | Clean baseline; WER(clean) gate input |
| T1a–c | 10 dB | 0.4 | default | balanced | s1 x DKITCHEN, SPSQUARE, OOFFICE | Pick the WORST noise (lowest turn-completion / highest false-turn-ends) as the gate noise |
| T2 | 10 dB | 0.5 | default | balanced | s1, worst noise | Less sensitive VAD: fewer false turn-ends from noise? |
| T3 | 10 dB | 0.3 | default | balanced | s1, worst noise | More sensitive VAD: better capture of buried speech? |
| T4 | 10 dB | best of T1–T3 | 0 | balanced | s1, worst noise | Instant barge-in yield |
| T5 | 10 dB | best | 200 | balanced | s1, worst noise | Debounced barge-in yield |
| T6 | 10 dB | best | best of T4/T5 | max_accuracy | s1, worst noise | Patience for long pauses (D2's stated hypothesis) |
| C1–C4 | 10 dB | winner combo | | | s2 + s3, 2 runs each | Confirmatory: seeded-error rescue (s2) + barge-in ≥2/3 (s3) |

Early-exit: if a 10 dB trial already meets ALL four pass criteria, jump
straight to C1–C4. If C fails, resume the sweep where you left it. Worst case
16 sessions ≈ $10.

If EVERYTHING above fails at 10 dB, one controlled last resort before calling
the gate: `vad_threshold` winner + `min_silence: 1000` / `max_silence: 3000`
(the official example values), accepting that adaptive pacing is lost. If that
also fails: **GATE FAILED**.

## 6. Scoring a session (run after EVERY session)

```bash
# single session (GT is matched by scenario_id inside the artifact):
node metrics/cli.js .data/gate/s1-happy-path__DKITCHEN-10db__vad040__id-def__balanced__r1.json \
  --gt data/ground-truth/gt-s1-happy-path.json --json

# aggregate a whole condition (all 3 GTs so any scenario matches):
node metrics/cli.js .data/gate/*__DKITCHEN-10db__vad040__id-def__balanced__r*.json \
  --gt data/ground-truth/gt-s1-happy-path.json data/ground-truth/gt-s2-pieza-mal-oida.json data/ground-truth/gt-s3-barge-in.json \
  --out .data/gate/report-DKITCHEN-10db-vad040.json
```

(Always pass `--out .data/gate/...` when aggregating — the default would write
`metrics/report.json` inside the tracked tree.)

**Which numbers to read** (paths in the `--json` output / report file):

| Number | Where | Gate use |
|---|---|---|
| WER | `aggregate.wer.wer` | clean ≤ 0.10 (criterion C4); 10 dB value is reported, not gated |
| Barge-in respected | `aggregate.bargein.pct_respected` (s3 sessions) | ≥ 2/3 (criterion C3) |
| False turn-ends | `sessions[].wer.unmatched` + count of `user_turn_end` events (below) | ≤ 1 per session at 10 dB (criterion C2) |
| Turn completion | count `transcript[]` role=user vs scripted turns (below) | ≥ 90% (criterion C1) |
| Latency p50/p95 | `aggregate.latency.tool.p50/p95`, `aggregate.latency.agent.*` | informative (D4 publish) |
| Extraction / piezas / confirmation recall | `aggregate.extraction.overall`, `aggregate.extraction.piezas.f1`, `aggregate.confirmation.recall` | informative for D2, gated in D4 |

The two raw counts (not in the report — read them off the artifact):

```bash
node -e "const a=require('./.data/gate/<artifact>.json'); \
  const ends=a.events.filter(e=>e.type==='user_turn_end').length; \
  const turns=a.transcript.filter(t=>t.role==='user').length; \
  console.log(JSON.stringify({user_turn_end_events:ends, transcript_user_turns:turns}))"
# scripted user turns: s1=10, s2=9, s3=9.
# C1 turn_completion = transcript_user_turns / scripted        (>= 0.90)
# C2 false_turn_ends  = max(0, user_turn_end_events - scripted) (<= 1 at 10 dB)
#    (fragments from noise-triggered turn ends inflate user_turn_end events;
#     cross-check with sessions[].wer.unmatched in the report)
```

## 7. PASS / FAIL criteria (quantified) and results table

A 10 dB session (or condition aggregate, same params) **PASSES** when:

- **C1 turn completion ≥ 90%** — `transcript` user turns ≥ 90% of scripted
  turns (s1: ≥9/10; s2/s3: 9/9, since 8/9 = 88.9% misses the bar). Partial
  transcripts of a scripted turn count only if the final `user_turn_end` text
  carries the turn's key content.
- **C2 false turn-ends ≤ 1 per session** — noise-triggered `user_turn_end`
  while a scripted turn is still being played (formula in §6).
- **C3 barge-in respected ≥ 2/3** — s3 sessions: ≥2 of the 3 provoked
  interruptions cut the agent in ≤500 ms (`aggregate.bargein.pct_respected ≥
  0.667`); agent must never talk over the correction.
- **C4 WER(clean) ≤ 0.10** — on the T0 clean sessions (refs = guion turns,
  hyps = `transcript[]`; `aggregate.wer.wer`).

**D2 GATE PASSED** = C1–C3 hold at 10 dB on the winner combo (confirmatory
runs included) AND C4 holds on clean. Otherwise, if **all** settings in §5
(incl. the last-resort row) fail C1–C3 at 10 dB → **GATE FAILED → Plan B (§8)**.
C4 failing on clean points at audio/format problems, not turn-taking — debug
before concluding (check mic format, playback rig, keyterms).

Results table (fill one row per session):

| Run | Guion | Condition | vad | ID ms | mode | C1 turn-compl | C2 false-ends | C3 barge-in | C4 WER | lat p50/p95 tool (ms) | Verdict |
|---|---|---|---|---|---|---|---|---|---|---|---|
| T0a | s1 | clean | 0.4 | def | balanced | 10/10 | 0 | n/a | | / | |
| T1a | s1 | DKITCHEN-10db | 0.4 | def | balanced | | | n/a | | / | |
| … | | | | | | | | | | / | |

Condition aggregate (for the README/D4):

| Condition | sessions | WER | barge-in respected | false-ends/session (max) | lat tool p50/p95 |
|---|---|---|---|---|---|
| clean | | | n/a | | |
| DKITCHEN-10db | | | | | |

## 8. If the gate fails — Plan B in one paragraph

**Voice Incident Reporter**: same WS plumbing, same tools/UI/metrics (~70%
code shared), but the interaction becomes short dictated incident notes
(post-visit, quiet environment) instead of live interview under shop noise —
the part that failed the gate is designed out, the confirmed differentiator
(read-back loop + measured accuracy) survives. Decision rule from
`docs/plan.md` D2: do not invest another day in the live-interview route once
the gate has failed at every setting.

## 9. Appendix — regenerating the material

```bash
# TTS of every scripted user turn (29 wavs; s2 t5 has the as-heard variant):
node scripts/tts-synth.mjs          # EDGE_TTS=<bin> if not on PATH
# DEMAND noise (Zenodo record 1227121; 1 channel kept per scenario, 24 kHz mono):
bash scripts/fetch-noise.sh         # SCENARIOS="DKITCHEN SPSQUARE OOFFICE" default
# Mixes (turn x noise x SNR; achieved SNR re-measured post-mix, warn if |dev|>1.5 dB):
node scripts/noise-mix.mjs          # --snrs 10,5,0 --force to redo everything
```

Notes:
- TTS material is DEV-ONLY (synthesized voice, gray-zone ToS): test sessions
  and WER references only — never in the demo video or published artifacts.
- All of `.data/` is gitignored (big binaries never enter git).
- Mix layout: `.data/noisy/<guion>/<noise>/<snr>db/turn-<n>.wav`; each dir's
  `manifest.json` records requested vs achieved SNR, peak dBFS, offsets and
  warn flags; `.data/noisy/manifest.json` indexes all combos.
- DEMAND usage note: research dataset distributed via Zenodo (record 1227121);
  cite the record when publishing numbers derived from it.

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

## ✅ Checkpoint 2 — T-AAI-2 real-session clip (DONE 2026-09-17)

Deliverables (NOT in the repo — sibling deliverables dir):

- `~/projects/field-service-voice-logger-deliverables/real-session-clip.mp4`
  — **55.0 s** (spec 45–60), 800×1760@8fps, silent, 1.3 MB, six beats:
  consent → dictation + `set_que_paso` → i2 PROD/STAGING disambiguation →
  tool-burst ficha fill → end screen → full artifact JSON (`GET /api/sessions?id=`).
  Persistent on-screen band: "REAL SESSION — live AssemblyAI Voice Agent API" +
  scripted-wav / never-stored / silent disclosure.
- `REAL-SESSION-NOTES.md` — commands, durations, cost ledger (~$1.0, five live
  takes), honest caveats (estado `en_proceso`, 1/many timeline hours captured,
  servicios `confirmado:false`, silent clip rationale).
- Working material: `real-session-take/take5-success/` (raw 189.4 s take,
  ws-trace, timeline, ficha/transcript snapshots) + `clip-driver.mjs`,
  `json-beat.mjs`, `probe-worklet.mjs` harness.

Key facts: session `sess_202609171957182` (mode real, i2, IC-2001), 169.6 s
audio, **58,312 input.audio frames, zero gaps >1.5 s** (max 0.31 s), 21 turns,
104 events, severidad corrected media→alta by voice, `audio_retained:false`.
Full artifact in repo `.data/sessions/sess_202609171957182.json`
(sha256 head cd21306e). Recording method: full Chromium + Xvfb + external
ffmpeg x11grab **8 fps ultrafast** — every CDP-capture and faster-x11grab
variant starves the AudioContext render thread (isolation matrix in the notes
and `clip-driver.mjs` header); 8 fps is the fastest rate that provably
coexists with the audio pipeline on this host.

## ✅ Checkpoint 3 — T-AAI-4 barge-in row (DONE 2026-09-17)

Row delivered by sibling session (README commit 007157b). This session pasted
the same row + compressed honest note into `docs/SUBMISSION.md` (metrics table
after "Confirmation-loop precision" + honest-notes bullet) — **kept uncommitted
with the other SUBMISSION.md hunks** (see entanglement below).

## ✅ Entanglement — RESUELTA (T7, 2026-09-17): commit `0e6b261`

Los 4 archivos (STATUS.md, docs/SUBMISSION-CHECKLIST.md, docs/SUBMISSION.md,
docs/VIDEO-REVIEW-GUIDE.md) se commitearon JUNTOS en **`0e6b261`** tras
refrescar todas las referencias de duración al master final. El master
CURRENT es **180.3 s (3:00), sha256 prefix `e662bb5f`** (iteración-3 final,
15:03; el `60f71f8e` / 180.2 s / 8.65 que esta sección registraba era el
baseline PRE-iteraciones — linaje completo en
`~/projects/field-service-voice-logger-deliverables/VIDEO-STATUS.md`; score
final 8.75). Sin push (sigue human-gated).

- Refrescos de duración incluidos en el commit: tabla de beats de la GUIDE
  re-anclada al SRT de 56 cues (10 filas + ventana del check-off + anclas de
  residuos/print-view), STATUS (7)/(389)/header, CHECKLIST ya estaba al día.
- Fix extra: pairing barge-in en SUBMISSION.md — artefactos reales
  R3a=9,034 / R3b=1,338 / R5c=20,501 ms (antes emparejados ascendente).

## ⏳ Remaining tasks

- ~~T-AAI-2~~ DONE. ~~T-AAI-4~~ DONE. ~~Commit de los 4 archivos~~ DONE
  (`0e6b261`, T7).
- Human gates (unchanged): push, submission text finalization, video review.
- **Flag-only (para el gate humano del ítem 7 del checklist):** `cover-c.png`
  (09:21) es píxel-stale vs el master final — frame 00:05 del it3 difiere en
  93% de píxeles (intro oscura nueva vs apertura vieja). cover-a/cover-b
  escenas no tocadas por it3 (solo zoom lento it1 podría desplazar píxeles).
  Regenerar cover-c del master final si se elige.

## Repo facts a sibling session needs

- Live deployment runs mock channel by design (no API key on Vercel).
- `npm run selftest` / `npm run smoke:mock` green as of the judge audit (09-17).
- Push is HUMAN-gated (checklist) — this session does not push.
- Video rounds are CLOSED 3/3 at **8.75** (master final `e662bb5f`, 180.3 s;
  `VIDEO-STATUS.md` en el dir de entregables — el 8.65 era el baseline
  pre-iteraciones) — do not reopen T-AAI-3.

## ✅ T7 — CERRADO (2026-09-17, sesión de continuación tras turn muerto 16:09)

Despacho: barrido de huérfanos + verificación T-AAI-2/4 + commit de los 4
archivos entangled + este cierre. Resumen en 5 líneas:

1. **Huérfanos**: kill del bash dev-server 1458778 + node 1458780 (puerto
   3199), únicos atribuibles al turn muerto; NO existía ningún monitor (la
   creencia del despacho era errónea); nada ambiguo pendiente.
2. **Clip T-AAI-2: REAL.** 55.0 s (spec 45–60), UI real variando + bandas de
   disclosure persistentes en cada frame (comando de ensamblado recuperado del
   transcript + varianza de píxeles PIL; sin visión in-env); silencioso POR
   DISEÑO documentado (banda + `-an`; AudioContext starved) — desviación del
   enunciado del despacho, reportada tal cual.
3. **Barge-in T-AAI-4: REAL.** 0/3 respetados; trazado a artefactos
   R3a=9,034 / R3b=1,338 / R5c=20,501 ms (`.data/gate/artifact-i3-*.json`,
   `interrupt_response:true`); pairing corregido en SUBMISSION.md; README
   nota (8) con el mismo desorden posicional — fuera de alcance, anotado.
4. **Commit**: `0e6b261` — 4 archivos, +119/−126, mensaje español sin
   atribución, sin rutas host; SIN push (human-gated).
5. **Duraciones**: todas las referencias vivas ahora dicen 180.3 s / 3:00 /
   31 MB / 56 cues (GUIDE re-anclada al SRT; STATUS codas; CHECKLIST ya
   al día). Flag-only: cover-c.png stale vs intro it3 (93% píxeles);
   "8.65" del despacho era baseline — final 8.75.

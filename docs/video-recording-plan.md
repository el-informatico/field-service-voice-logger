# Recording plan (D6) — executable, beat by beat

Goal: 4:40–5:00 EN video per docs/video-script-en.md. Everything records
against LOCAL state (no push needed).

## Equipment checklist

- [ ] USB mic or headset (the one you'll demo with) + quiet room (the product
      IS quiet-dictation — the room proves the wedge).
- [ ] Browser at 360–420 px width (DevTools device toolbar) for the mobile UI;
      1080p+ screen recording, 30 fps minimum.
- [ ] Screen recorder with system audio (agent TTS must be audible):
      OBS (Windows side) or `wf-recorder`/ffmpeg x11grab on WSL if running a
      Linux GUI; simplest: record on the Windows desktop over the WSL-served
      page.
- [ ] Optional second angle: phone filming the operator speaking (cutaway for
      the roleplay beat).
- [ ] Voice-over mic for Beats 1 and 4 (can be recorded after, synced to timecode).

## Pre-flight (once)

```bash
cd ~/projects/field-service-voice-logger
npm run selftest && npm run smoke:mock      # everything green before recording
bash scripts/demo-video.sh                  # one-command demo (see docs/video-demo-setup.md)
# → prints http://[::1]:3199  (open in browser on the Windows side via the
#   WSL localhost mirror; if the mirror is flaky, use the printed port with
#   HOST=0.0.0.0 bash scripts/demo-video.sh)
```

Decide the roleplay mode BEFORE recording (label it on screen):
- **Deterministic replay (recommended for takes)**: mock mode, "auto-replay"
  ON, incident IC-2003 / scenario `i1-dictado-feliz` — unlimited retries, zero
  cost. On-screen caption: "deterministic replay of a scripted session".
- **Live API session (recommended for ONE hero take)**: `ASSEMBLYAI_API_KEY`
  in `.env`, mode badge shows `real`, follow the i2 beats (production/staging
  read-back) yourself. Caption: "live API session". Budget ~$0.2/take.

## Per-beat capture list

| Beat | Time | Capture | How |
|---|---|---|---|
| 1 Pain | 0:00–0:20 | B-roll: paper notes photo; split screen typing vs speaking | phone camera / stock of YOUR notes; VO recorded separately |
| 2 Roleplay | 0:20–3:20 | Full browser window, ficha visible while transcript scrolls | demo-video.sh running; follow video-script beats: IC-2003 → consent → dictation → timeline read-back → PROD/STAGING disambiguation → severity → action items |
| 2b Numbers | 2:30–3:20 | README §Metrics on screen, highlight rows (awk-free: scroll slowly) | pre-open the README section; zoom 125% |
| 3 Export | 3:20–4:10 | CSV download (open the file 2s), PDF print preview, FSM ack toast | the four end-screen buttons; CSV opens in editor; PDF in browser print dialog |
| 4 Architecture | 4:10–4:50 | docs/assets diagram (or draw it) + repo URL end card | keep the diagram static, animate with zoom only |

## Editing notes

- On-screen captions (small, corner): mode badge ("real API" / "replay"),
  incident ID, and during Beat 2b: "measured, N=5 — failures included".
- Never show: `.env`, keys, terminal scrollback with local paths.
- Cut points land on the read-back question and the ✓ chip flip — those two
  moments ARE the product.
- Export 1080p; audio -14 LUFS approx.

## Submission checklist (separate from recording)

- [ ] Re-audit gallery first (AutoCopilot/KiaOra unverifiable as of 09-15 —
      check for new field/incident-reporter entries before recording the
      differentiation line).
- [ ] Video < 5:00 hard limit; upload unlisted → test on phone.
- [ ] lablab submission: repo URL + video + one-line pitch. Deadline margin:
      manual approval window (~6h) — submit ≥ 12h before 30-sep 15:00 UTC.

# One-command demo setup (for recording)

`bash scripts/demo-video.sh` boots everything the video needs:

1. Dev server (`scripts/dev-server.mjs`) on port 3199 (override `PORT`).
2. Serves the UI at `/`, seed data, `/api/*` (token mock unless the key is in
   `.env`, sessions, FSM).
3. Prints a ready-to-follow recording runbook (order/incident pickers, the
   beats that matter) plus a pre-seeded session flow for the FSM ack.
4. Cleanup on Ctrl-C (server killed).

## Modes

- Mock (default, deterministic, $0): mode badge shows `mock`. Use scenario
  `i1-dictado-feliz` with auto-replay ON for repeatable takes; or drive it
  yourself typing the operator turns (input box) — the read-back banner and
  ficha react identically.
- Real (key in `.env`): badge shows `real`; speak the i2 beats
  (production/staging) for the hero take. Cost ≈ $0.2 per session.

## What "ready to record" looks like

- Dashboard lists IC-2001..IC-2008 (pick **IC-2003** for the script's story).
- Session screen: sticky bar (incident + severity chip + timer), transcript
  column, ficha cards with audit lines, amber read-back banner, ¡Espera!
  button.
- End screen: the four export buttons (CSV / PDF / artifact / FSM).

## Troubleshooting

- Browser can't reach `[::1]`: run `HOST=0.0.0.0 bash scripts/demo-video.sh`
  and use the machine IP (WSL mirrored-networking quirk; IPv4 loopback hangs).
- Mic not prompted in real mode: click the page first; consent gate must be
  accepted before getUserMedia.

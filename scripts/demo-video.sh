#!/usr/bin/env bash
# demo-video.sh — one-command self-contained demo for recording (D6).
# Boots the dev server + prints the recording runbook. Ctrl-C cleans up.
#   bash scripts/demo-video.sh                 # mock mode (deterministic, $0)
#   HOST=0.0.0.0 PORT=3299 bash scripts/demo-video.sh
# Real mode: put ASSEMBLYAI_API_KEY in .env first (badge flips to "real").
set -euo pipefail
cd "$(dirname "$0")/.."

PORT="${PORT:-3199}"
export HOST="${HOST:-::1}"

if [ -f .env ] && grep -qE '^ASSEMBLYAI_API_KEY=..' .env; then
  MODE="real (key detected — live sessions available, ~\$0.2/take)"
else
  MODE="mock (deterministic, \$0 — add the key to .env for live sessions)"
fi

echo "== Voice Incident Reporter — demo ready check =="
npm run selftest >/dev/null && echo "selftest: GREEN" || { echo "selftest FAILED — fix before recording"; exit 1; }

node scripts/dev-server.mjs &
SRV=$!
trap 'kill $SRV 2>/dev/null || true; pkill -f "^node scripts/dev-server" 2>/dev/null || true; echo "demo server stopped"' EXIT INT TERM
sleep 1.5

URL="http://[${HOST}]:${PORT}"
if [ "${HOST}" = "0.0.0.0" ]; then URL="http://$(hostname -I | awk "{print \$1}"):${PORT}"; fi

for i in $(seq 1 10); do
  curl -s --max-time 2 -o /dev/null "$URL/" && break || sleep 0.5
done

cat << EOF

===================================================================
 DEMO UP  →  $URL          mode: $MODE
===================================================================
 RECORDING RUNBOOK (docs/video-script-en.md for full beats)

 1. Browser width 360-420px (DevTools device toolbar).
 2. Dashboard → pick incident IC-2003 (network outage story).
 3. Consent screen → accept → session starts (timer ticks).
 4. MOCK+auto-replay: scenario i1-dictado-feliz replays itself;
    or drive it live typing operator turns in the input box.
    REAL: speak the beats — outage ~8:50 → production/staging
    read-back → severity alta → action items → "mándalo".
 5. Watch: timeline rows fill, service chip flips ⏳→✓ on confirm,
    amber read-back banner = the differentiator moment. Zoom in.
 6. End screen → CSV (open file 2s) → PDF print preview →
    "Send to FSM" (ack toast with FSM id).
 7. Beat 2b: open README §Metrics — scroll the real table slowly.

 Ctrl-C to stop. Never show .env or terminal scrollback with paths.
===================================================================
EOF
wait $SRV

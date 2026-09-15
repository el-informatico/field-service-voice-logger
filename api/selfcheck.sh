#!/usr/bin/env bash
# api/selfcheck.sh — curl-based smoke test for the backend deliverables.
# Starts scripts/dev-server.mjs on a scratch port (mock mode forced), exercises
# /api/token, /api/sessions (+ privacy invariants), static serving and the
# traversal guards, then kills the server. Exits 1 if any check fails.
#
# Usage: bash api/selfcheck.sh   [SELFCHECK_PORT=4173]   [SESSIONS_DIR=...]

set -u
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORT="${SELFCHECK_PORT:-4173}"
# Default to IPv6 loopback: WSL2 mirrored networking can leave 127.0.0.1
# connections hanging, while ::1 works on any Linux. Override SELFCHECK_HOST.
HOST6="${SELFCHECK_HOST:-::1}"
case "$HOST6" in
  *:*) BASE="http://[${HOST6}]:${PORT}" ;;
  *)   BASE="http://${HOST6}:${PORT}" ;;
esac
SESSIONS_DIR="${SESSIONS_DIR:-$ROOT/.data/sessions}"
SERVER_LOG="$(mktemp /tmp/fsvl-selfcheck-server.XXXXXX.log)"
FAILURES=0
SID="selfcheck_$$"

pass() { printf 'PASS: %s\n' "$*"; }
fail() { printf 'FAIL: %s\n' "$*"; FAILURES=$((FAILURES + 1)); }
expect_eq() { # desc got want
  if [ "$2" = "$3" ]; then pass "$1"; else fail "$1 — got '$2', want '$3'"; fi
}
jget() { # json dot.path -> scalar as string ("" if absent)
  node -e '
    const j = JSON.parse(process.argv[1]);
    let v = j;
    for (const k of process.argv[2].split(".").filter(Boolean)) v = v == null ? undefined : v[k];
    if (v === undefined || v === null) process.stdout.write("");
    else if (typeof v === "object") process.stdout.write(JSON.stringify(v));
    else process.stdout.write(String(v));
  ' "$1" "$2" 2>/dev/null
}

command -v curl >/dev/null 2>&1 || { echo "FAIL: curl is required"; exit 1; }
command -v node >/dev/null 2>&1 || { echo "FAIL: node is required"; exit 1; }

# --- start dev server (empty key forces mock mode deterministically) ---------
cd "$ROOT" || exit 1
mkdir -p "$SESSIONS_DIR"
ASSEMBLYAI_API_KEY="" PORT="$PORT" HOST="$HOST6" SESSIONS_DIR="$SESSIONS_DIR" \
  node scripts/dev-server.mjs >"$SERVER_LOG" 2>&1 &
SERVER_PID=$!
trap 'kill "$SERVER_PID" 2>/dev/null; wait "$SERVER_PID" 2>/dev/null; rm -f "$SESSIONS_DIR/$SID.json" "$SERVER_LOG"' EXIT

for _ in $(seq 1 60); do
  curl -m 2 --connect-timeout 1 -fsS -o /dev/null "$BASE/api/token" 2>/dev/null && break
  if ! kill -0 "$SERVER_PID" 2>/dev/null; then
    echo "FAIL: dev server exited during startup"; cat "$SERVER_LOG"; exit 1
  fi
  sleep 0.1
done

# Response helper: sets REPLY_BODY / REPLY_CODE from a curl invocation.
req() {
  local raw
  raw="$(curl -m 10 --connect-timeout 3 -sS -w $'\n%{http_code}' "$@" 2>/dev/null)" || raw=$'\n000'
  REPLY_CODE="${raw##*$'\n'}"
  REPLY_BODY="${raw%$'\n'*}"
}

echo "== /api/token =="
req "$BASE/api/token"
expect_eq "GET /api/token HTTP status" "$REPLY_CODE" "200"
expect_eq "GET /api/token mode" "$(jget "$REPLY_BODY" .mode)" "mock"
expect_eq "GET /api/token token" "$(jget "$REPLY_BODY" .token)" "mock-token"
expect_eq "GET /api/token expires_in_seconds" "$(jget "$REPLY_BODY" .expires_in_seconds)" "0"

req -X POST "$BASE/api/token"
expect_eq "POST /api/token HTTP status (identical behavior)" "$REPLY_CODE" "200"
expect_eq "POST /api/token mode" "$(jget "$REPLY_BODY" .mode)" "mock"

req "$BASE/api/token?expires_in_seconds=99999"
CLAMPED="$(jget "$REPLY_BODY" .expires_in_seconds)"
[ "$REPLY_CODE" = 200 ] && [ "$CLAMPED" = 0 ] && pass "query clamp tolerated in mock mode" \
  || fail "query clamp — code=$REPLY_CODE expires=$CLAMPED (mock reports 0 by design)"

H="$(curl -m 10 -sS -I "$BASE/api/token" 2>/dev/null | tr -d '\r' | grep -i '^cache-control:' | head -n1)"
case "$H" in *[Nn]o-[Ss]tore*) pass "Cache-Control: no-store on /api/token";; *) fail "Cache-Control header missing: '$H'";; esac

req -X DELETE "$BASE/api/token"
expect_eq "DELETE /api/token rejected" "$REPLY_CODE" "405"

echo "== /api/sessions =="
VALID="{\"schema_version\":1,\"session_id\":\"$SID\",\"scenario_id\":\"selfcheck\",\"mode\":\"mock\",\"order_id\":\"OT-1042\",\"started_at\":\"2026-09-15T14:03:11.240Z\",\"ended_at\":\"2026-09-15T14:04:11.240Z\",\"audio_retained\":false,\"events\":[{\"t_ms\":0,\"type\":\"session_start\"},{\"t_ms\":6000,\"type\":\"tool_call\",\"call_id\":\"c1\",\"tool\":\"buscar_pieza\",\"args\":{\"consulta\":\"valvula 3/4\"}}],\"transcript\":[],\"final_form\":{\"order_id\":\"OT-1042\",\"estado\":\"enviada\"}}"

req -H 'content-type: application/json' --data "$VALID" "$BASE/api/sessions"
expect_eq "POST valid artifact HTTP status" "$REPLY_CODE" "200"
expect_eq "POST valid artifact ok" "$(jget "$REPLY_BODY" .ok)" "true"
expect_eq "POST valid artifact stored" "$(jget "$REPLY_BODY" .stored)" "true"
expect_eq "POST valid artifact echoes id" "$(jget "$REPLY_BODY" .id)" "$SID"
if [ -f "$SESSIONS_DIR/$SID.json" ]; then pass "artifact file written under $SESSIONS_DIR"; else fail "artifact file missing: $SESSIONS_DIR/$SID.json"; fi

RETAINED="$(node -e 'const a=JSON.parse(process.argv[1]); a.audio_retained=true; process.stdout.write(JSON.stringify(a))' "$VALID")"
req -H 'content-type: application/json' --data "$RETAINED" "$BASE/api/sessions"
expect_eq "POST audio_retained:true rejected" "$REPLY_CODE" "400"

HUGE="$(node -e 'const a=JSON.parse(process.argv[1]); a.events.push({type:"user_turn_end", text:"data:audio/pcm;base64,"+("A".repeat(100*1024))}); process.stdout.write(JSON.stringify(a))' "$VALID")"
req -H 'content-type: application/json' --data "$HUGE" "$BASE/api/sessions"
expect_eq "POST huge base64 field rejected" "$REPLY_CODE" "400"
case "$(jget "$REPLY_BODY" .message)" in *audio-like*) pass "huge base64 refusal names 'audio-like payload refused'";; *) fail "refusal message: $(jget "$REPLY_BODY" .message)";; esac

NOFORM="$(node -e 'const a=JSON.parse(process.argv[1]); delete a.final_form; process.stdout.write(JSON.stringify(a))' "$VALID")"
req -H 'content-type: application/json' --data "$NOFORM" "$BASE/api/sessions"
expect_eq "POST missing final_form rejected" "$REPLY_CODE" "400"

req -H 'content-type: application/json' --data 'this is not json' "$BASE/api/sessions"
expect_eq "POST invalid JSON rejected" "$REPLY_CODE" "400"

req "$BASE/api/sessions"
expect_eq "GET list HTTP status" "$REPLY_CODE" "200"
LIST_COUNT="$(jget "$REPLY_BODY" .count)"
[ "$REPLY_CODE" = 200 ] && [ "$LIST_COUNT" -ge 1 ] 2>/dev/null && pass "GET list includes stored session (count=$LIST_COUNT)" || fail "GET list count=$LIST_COUNT"
LIST_HAS="$(jget "$REPLY_BODY" .sessions)" # spot-check metadata fields on first entry
FIRST_ID="$(node -e 'const j=JSON.parse(process.argv[1]); const s=(j.sessions||[])[0]||{}; process.stdout.write(String(s.id||""))' "$REPLY_BODY")"
expect_eq "list metadata carries id" "$FIRST_ID" "$SID"

req "$BASE/api/sessions?id=$SID"
expect_eq "GET ?id= artifact HTTP status" "$REPLY_CODE" "200"
expect_eq "GET ?id= artifact order_id" "$(jget "$REPLY_BODY" .order_id)" "OT-1042"
expect_eq "GET ?id= artifact audio_retained" "$(jget "$REPLY_BODY" .audio_retained)" "false"

req --path-as-is "$BASE/api/sessions?id=../../etc/passwd"
expect_eq "GET ?id= traversal rejected" "$REPLY_CODE" "400"

req "$BASE/api/sessions?id=nope_$SID"
expect_eq "GET ?id= unknown session" "$REPLY_CODE" "404"

echo "== static + routing =="
req "$BASE/"
expect_eq "GET / HTTP status" "$REPLY_CODE" "200"
case "$REPLY_BODY" in *Field\ Service\ Voice\ Logger*) pass "GET / serves web/index.html";; *) fail "GET / body lacks app title";; esac

req "$BASE/data/ordenes.json"
if [ "$REPLY_CODE" = "200" ]; then
  case "$REPLY_BODY" in '['*|'{'*) pass "GET /data/ordenes.json → 200 JSON";; *) fail "GET /data/ordenes.json 200 but body is not JSON";; esac
elif [ "$REPLY_CODE" = "404" ]; then
  pass "GET /data/ordenes.json → 404 (file not created yet — acceptable)"
else
  fail "GET /data/ordenes.json — unexpected HTTP $REPLY_CODE"
fi

req --path-as-is "$BASE/../../../etc/passwd"
expect_eq "path traversal on static route blocked" "$REPLY_CODE" "404"

req "$BASE/api/does-not-exist"
expect_eq "unknown /api route → JSON 404" "$REPLY_CODE" "404"

echo
if [ "$FAILURES" -eq 0 ]; then
  echo "SELFCHECK OK — all checks passed"
else
  echo "SELFCHECK FAILED — $FAILURES check(s) failed"
  echo "--- server log ($SERVER_LOG) ---"
  cat "$SERVER_LOG"
fi
exit $((FAILURES > 0 ? 1 : 0))

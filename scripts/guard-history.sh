#!/usr/bin/env bash
# History guard: refuses a push whose TRAVELING commits would introduce
# configured sensitive tokens — in the cumulative tree diff against the
# remote ref, or in the commit messages of the range. Invoked by
# scripts/hooks/pre-push (core.hooksPath wiring); can also be run by hand.
#
# INVARIANT ENFORCED (range mode, the hook default): no commit reaching a
# remote may introduce configured sensitive tokens that the remote's
# current history does not already carry. Already-published occurrences
# are out of scope — this is the push-side twin of the staged-lines
# invariant in scripts/guard-sensitive-content.sh.
#
# MODES
#   (no args, pre-push stdin)  hook mode: one "<local-ref> <local-sha>
#                              <remote-ref> <remote-sha>" line per pushed
#                              ref; each range is scanned. All-zero remote
#                              sha (new branch) scans that ref's full
#                              history; all-zero local sha (deletion) is
#                              skipped.
#   FROM..TO | FROM TO         explicit range: same scan, no stdin needed.
#   --full                     audit mode: dumps `git log --all -p` and
#                              reports every token occurrence with SHA
#                              attribution. This is a REPORT, not a push
#                              gate — known residuals accepted by the
#                              owner (see the pre-push audit doc) will and
#                              should make it exit 1; the exit code means
#                              "history is not token-clean", nothing more.
#
# TOKEN LIST: literal fixed strings, one per line, blank lines ignored,
# read from  $(git rev-parse --absolute-git-dir)/sensitive-tokens
# The tokens ARE the sensitive strings, so the list must never live in
# tracked content (git dir is per-clone; reseed from the local reference
# copy kept outside the repository after a fresh clone — CONTRIBUTING.md).
#
# EXIT CODES: Violation => exit 1. Guard-internal failure (no git dir,
# mktemp failure, or tokens path present but not a readable regular
# file) => exit 2, failing closed per design. Clean, or check disabled
# (tokens file absent/empty) => exit 0 — fail-open bootstrap precedent.
#
# HONEST BOUNDARY: `git push --no-verify` bypasses it; a token added and
# then removed WITHIN an unpushed range still travels in the intermediate
# commit patches and is NOT caught in range mode (use --full for that);
# binary content is not scanned (git emits no content lines for it);
# matching content is never printed or logged — refs, file names, and
# counts only.
set -u

GIT_DIR="$(git rev-parse --absolute-git-dir)" || {
  echo "guard-history: cannot determine git dir" >&2
  exit 2
}
TOKENS="$GIT_DIR/sensitive-tokens"

if [ ! -e "$TOKENS" ] && [ ! -L "$TOKENS" ]; then
  echo "guard-history: no sensitive-tokens list in the git dir; check disabled" >&2
  exit 0
fi
if [ ! -f "$TOKENS" ] || [ ! -r "$TOKENS" ]; then
  echo "guard-history: sensitive-tokens exists but is not a readable file; failing closed per design" >&2
  exit 2
fi

PATTERNS="$(mktemp)" || {
  echo "guard-history: mktemp failed; failing closed per design" >&2
  exit 2
}
trap 'rm -f "$PATTERNS"' EXIT
# Strip CR (the list may be edited from the Windows side) and blanks —
# a blank pattern would match everything.
if ! tr -d '\r' < "$TOKENS" | sed -e '/^[[:space:]]*$/d' > "$PATTERNS"; then
  echo "guard-history: cannot sanitize token list; failing closed per design" >&2
  exit 2
fi
if [ ! -s "$PATTERNS" ]; then
  echo "guard-history: sensitive-tokens carries no usable lines; check disabled" >&2
  exit 0
fi

# scan_range <range> — cumulative tree diff (file attribution) + commit
# messages (SHA attribution) for every commit in the range.
scan_range() {
  range="$1"
  fail=0

  # Tree diff: added lines only, taken from INSIDE the hunks (same
  # extraction as guard-sensitive-content.sh, so header-shaped added
  # lines are still scanned and the +++ header never is).
  while IFS= read -r -d '' f; do
    added="$(git diff -U0 "$range" -- "$f" \
             | awk '/^@@/{inhunk=1; next} inhunk && /^\+/{sub(/^./,""); print}')"
    [ -n "$added" ] || continue
    if printf '%s\n' "$added" | grep -iaFqf "$PATTERNS"; then
      echo "guard-history: BLOCKED — range $range adds token-bearing lines in $f" >&2
      fail=1
    fi
  done < <(git diff "$range" --name-only -z --diff-filter=ACMR)

  # Commit messages of the range, attributed by SHA.
  git log "$range" --format='%H' 2>/dev/null | while IFS= read -r sha; do
    if git log -1 --format=%B "$sha" | grep -iaFqf "$PATTERNS"; then
      echo "guard-history: BLOCKED — commit message of $sha matches the token list" >&2
      echo 1 > "$MSGFAIL"
    fi
  done
  if [ -e "$MSGFAIL" ]; then
    fail=1
  fi

  return "$fail"
}

# scan_full — whole-history dump with SHA+file attribution.
scan_full() {
  DUMP="$(mktemp)" || {
    echo "guard-history: mktemp failed; failing closed per design" >&2
    exit 2
  }
  if ! git log --all -p --no-color > "$DUMP" 2>/dev/null; then
    echo "guard-history: cannot dump history; failing closed per design" >&2
    rm -f "$DUMP"
    exit 2
  fi
  hits="$(awk -v patfile="$PATTERNS" '
    BEGIN { while ((getline t < patfile) > 0) { cr = t; gsub(/\r/, "", cr); if (cr !~ /^[[:space:]]*$/) pats[++n] = tolower(cr) } }
    /^commit / { sha = $2; next }
    /^\+\+\+ b\// { f = $2; next }
    /^\+/ && !/^\+\+\+/ {
      line = tolower($0)
      for (i = 1; i <= n; i++) if (index(line, pats[i]) > 0) { print sha " " f; break }
    }
  ' "$DUMP" | sort -u)"
  rm -f "$DUMP"
  if [ -n "$hits" ]; then
    echo "guard-history: token occurrences in history (audit mode; owner-accepted" >&2
    echo "  residuals are expected here — see the pre-push audit doc):" >&2
    printf '%s\n' "$hits" | while IFS= read -r line; do
      echo "    $line" >&2
    done
    return 1
  fi
  return 0
}

MSGFAIL="$(mktemp)" || {
  echo "guard-history: mktemp failed; failing closed per design" >&2
  exit 2
}
rm -f "$MSGFAIL"

rc=0
case "${1-}" in
  --full)
    scan_full || rc=1
    ;;
  "")
    # Hook mode: pre-push stdin. Absence of stdin (manual run) falls back
    # to the upstream range, so `scripts/guard-history.sh` alone still
    # checks exactly what a plain `git push` would send.
    if [ -t 0 ]; then
      upstream="$(git rev-parse --symbolic-full-name @{upstream} 2>/dev/null)" \
        && range="${upstream}..HEAD" \
        || range="origin/main..HEAD"
      echo "guard-history: no stdin; scanning default range $range" >&2
      scan_range "$range" || rc=1
    else
      while read -r local_ref local_sha remote_ref remote_sha; do
        case "$local_sha" in
          0000000000000000000000000000000000000000) continue ;;  # deletion
          *)
            case "$remote_sha" in
              0000000000000000000000000000000000000000)
                echo "guard-history: $remote_ref is new; scanning full history of $local_sha" >&2
                git log "$local_sha" --format='%H' 2>/dev/null | while IFS= read -r sha; do
                  if git log -1 --format=%B "$sha" | grep -iaFqf "$PATTERNS"; then
                    echo "guard-history: BLOCKED — commit message of $sha matches the token list" >&2
                    echo 1 > "$MSGFAIL"
                  fi
                done
                [ -e "$MSGFAIL" ] && rc=1
                ;;
              *)
                scan_range "$remote_sha..$local_sha" || rc=1
                ;;
            esac
            ;;
        esac
      done
    fi
    ;;
  *)
    # Explicit range: accept both "A..B" and "A B".
    if [ $# -eq 1 ]; then
      scan_range "$1" || rc=1
    elif [ $# -eq 2 ]; then
      scan_range "$1..$2" || rc=1
    else
      echo "usage: guard-history.sh [--full | FROM..TO | FROM TO]" >&2
      rm -f "$MSGFAIL"
      exit 2
    fi
    ;;
esac

rm -f "$MSGFAIL"

if [ "$rc" -ne 0 ]; then
  echo "  Drop the flagged content (or get the owner to accept it in the audit" >&2
  echo "  doc), amend/redo the commits, and push again; do not use --no-verify." >&2
  echo "  Rule: CONTRIBUTING.md" >&2
  echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) BLOCK(history: range scan)" \
    >> "$GIT_DIR/guard-audit.log" 2>/dev/null || true
fi
exit "$rc"

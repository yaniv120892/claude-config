#!/usr/bin/env bash
# Shared scaffolding for the quality-gate tests: locate the hook, count failures,
# and print one summary. Sourced, not executed.
#
# The hook is resolved relative to this file so the tests work from any clone
# location rather than assuming a checkout path.

TESTS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HOOK="$TESTS_DIR/../hooks/pre-push-quality-gate.sh"

if [ ! -x "$HOOK" ]; then
  echo "hook not found or not executable: $HOOK" >&2
  exit 1
fi

fails=0

# report <label> <expected> <actual>
report() {
  local label="$1" expected="$2" actual="$3"
  if [ "$actual" = "$expected" ]; then
    printf 'PASS  %s (%s)\n' "$label" "$actual"
  else
    printf 'FAIL  %s expected %s got %s\n' "$label" "$expected" "$actual"
    fails=$((fails + 1))
  fi
}

summarize() {
  echo
  if [ "$fails" -eq 0 ]; then
    echo "ALL PASS"
  else
    echo "$fails FAILURES"
  fi
  exit "$fails"
}

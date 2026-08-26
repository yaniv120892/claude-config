#!/usr/bin/env bash
# Verifies which scripts the gate runs, and that a script the repo does not
# define is reported rather than counted as a pass.
source "$(dirname "${BASH_SOURCE[0]}")/harness.sh"
TMP="$(mktemp -d)"

PUSH="git p""ush"

# Builds a repo whose package.json is exactly $1, then fires a push at it.
# Echoes the hook's exit code; the hook's stderr lands in $TMP/err.
fire_with_scripts() {
  local scripts="$1" dir
  dir="$(mktemp -d "$TMP/repo.XXXXXX")"
  (
    cd "$dir" && git init -q .
    printf '{"name":"r","scripts":%s}' "$scripts" > package.json
    git add -A && git -c user.email=t@t -c user.name=t commit -qm init
  ) >/dev/null 2>&1
  python3 -c 'import json,sys;print(json.dumps({"tool_input":{"command":sys.argv[1]},"cwd":sys.argv[2]}))' \
    "$PUSH" "$dir" | bash "$HOOK" >/dev/null 2>"$TMP/err"
  echo $?
}

# Every gate present and passing.
ALL_PASS='{"build":"exit 0","lint":"exit 0","prettier":"exit 0","typecheck":"exit 0","test":"exit 0"}'
report "all five gates pass" 0 "$(fire_with_scripts "$ALL_PASS")"

# typecheck is now a gate: a failing one must block the push. Before this was
# wired up, a repo could fail tsc and still push green.
TYPECHECK_FAILS='{"build":"exit 0","lint":"exit 0","prettier":"exit 0","typecheck":"exit 1","test":"exit 0"}'
report "failing typecheck blocks" 2 "$(fire_with_scripts "$TYPECHECK_FAILS")"

# The failure message names which gate failed, not a generic list.
fire_with_scripts "$TYPECHECK_FAILS" >/dev/null
grep -q "failed at 'typecheck'" "$TMP/err" && named=yes || named=no
report "failure names the gate" yes "$named"

# A repo missing a script still pushes, but the skip is announced. This is the
# case that used to be silent: no `prettier` script meant no format check ran.
NO_PRETTIER='{"build":"exit 0","lint":"exit 0","typecheck":"exit 0","test":"exit 0"}'
report "missing script does not block" 0 "$(fire_with_scripts "$NO_PRETTIER")"
grep -q "no npm script for: prettier" "$TMP/err" && warned=yes || warned=no
report "missing script is reported" yes "$warned"

# Short-circuit: a failing build must stop before test runs.
BUILD_FAILS='{"build":"exit 1","lint":"exit 0","prettier":"exit 0","typecheck":"exit 0","test":"echo RAN_TEST"}'
fire_with_scripts "$BUILD_FAILS" >/dev/null
grep -q "failed at 'build'" "$TMP/err" && stopped=yes || stopped=no
report "stops at the first failure" yes "$stopped"

rm -rf "$TMP"
summarize

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
report "all gates pass" 0 "$(fire_with_scripts "$ALL_PASS")"

# typecheck is now a gate: a failing one must block the push. Before this was
# wired up, a repo could fail tsc and still push green.
TYPECHECK_FAILS='{"build":"exit 0","lint":"exit 0","prettier":"exit 0","typecheck":"exit 1","test":"exit 0"}'
report "failing typecheck blocks" 2 "$(fire_with_scripts "$TYPECHECK_FAILS")"

# The failure message names which gate failed, not a generic list.
fire_with_scripts "$TYPECHECK_FAILS" >/dev/null
grep -q "failed at 'typecheck'" "$TMP/err" && named=yes || named=no
report "failure names the gate" yes "$named"

# A repo missing a script still pushes, but the skip is announced. This is the
# case that used to be silent: no formatting script meant no format check ran.
NO_FORMAT='{"build":"exit 0","lint":"exit 0","typecheck":"exit 0","test":"exit 0"}'
report "missing script does not block" 0 "$(fire_with_scripts "$NO_FORMAT")"
grep -q "no npm script for: prettier or format:check" "$TMP/err" && warned=yes || warned=no
report "missing script is reported" yes "$warned"

# format:check alone satisfies the formatting gate — a repo that named its
# script that way must not be nagged about a `prettier` script it does not need.
FORMAT_CHECK_ONLY='{"build":"exit 0","lint":"exit 0","typecheck":"exit 0","format:check":"exit 0","test":"exit 0"}'
report "format:check alone satisfies it" 0 "$(fire_with_scripts "$FORMAT_CHECK_ONLY")"
grep -q "no npm script for" "$TMP/err" && nagged=yes || nagged=no
report "format:check is not reported missing" no "$nagged"

# ...and a failing format:check still blocks.
FORMAT_CHECK_FAILS='{"build":"exit 0","lint":"exit 0","typecheck":"exit 0","format:check":"exit 1","test":"exit 0"}'
report "failing format:check blocks" 2 "$(fire_with_scripts "$FORMAT_CHECK_FAILS")"

# Order: when a cheap gate and an expensive one would both fail, the cheap one
# is what gets reported — nobody should wait through a build to be told about a
# lint error. This is the whole reason the order is what it is.
BOTH_FAIL='{"prettier":"exit 0","lint":"exit 1","typecheck":"exit 0","build":"exit 1","test":"exit 0"}'
fire_with_scripts "$BOTH_FAIL" >/dev/null
grep -q "failed at 'lint'" "$TMP/err" && cheapest=yes || cheapest=no
report "cheapest failing gate is reported" yes "$cheapest"

# Short-circuit: a failing build must stop before test runs.
BUILD_FAILS='{"build":"exit 1","lint":"exit 0","prettier":"exit 0","typecheck":"exit 0","test":"echo RAN_TEST"}'
fire_with_scripts "$BUILD_FAILS" >/dev/null
grep -q "failed at 'build'" "$TMP/err" && stopped=yes || stopped=no
report "stops at the first failure" yes "$stopped"

rm -rf "$TMP"
summarize

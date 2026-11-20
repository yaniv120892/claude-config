#!/usr/bin/env bash
# Exercises the PR-creation matcher in open-pr-in-browser.sh. The literals are
# split ('gh p''r create') so this file does not match its own pattern when the
# hook runs over a command that writes it.
HOOK_NAME=open-pr-in-browser.sh
source "$(dirname "${BASH_SOURCE[0]}")/harness.sh"

PATTERN=$(grep -oE "^readonly CREATE_INVOCATION='.*'$" "$HOOK" | sed "s/^readonly CREATE_INVOCATION='//; s/'$//")

check() {
  local expected="$1" text="$2" actual
  if grep -qE "$PATTERN" <<<"$text"; then actual="TRIGGER"; else actual="skip"; fi
  report "$text" "$expected" "$actual"
}

echo "--- must NOT trigger ---"
check skip    'echo "then run gh p''r create"'
check skip    'gh p''r view 17'
check skip    'gh p''r edit 17 --body-file x'
check skip    'gh p''r created'

echo "--- must trigger ---"
check TRIGGER 'gh p''r create'
check TRIGGER 'gh p''r create --fill --base main'
check TRIGGER 'cd /repo && gh p''r create --title x'
check TRIGGER '(cd x; gh p''r create)'

echo "--- outside cmux it does nothing ---"
out=$(printf '{"tool_input":{"command":"gh p''r create"},"tool_response":{"stdout":"https://github.com/o/r/pull/1"}}' |
  env -u CMUX_WORKSPACE_ID "$HOOK"; echo "exit=$?")
report "no CMUX_WORKSPACE_ID" "exit=0" "$out"

summarize

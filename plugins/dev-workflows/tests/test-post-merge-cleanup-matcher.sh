#!/usr/bin/env bash
# Exercises the merge-invocation matcher in post-merge-cleanup.sh, the guard that
# decides whether the hook asks the forge about a merge at all. The literals are
# split ('gh p''r merge') so this file does not match its own pattern when the
# hook runs over a command that writes it.
HOOK_NAME=post-merge-cleanup.sh
source "$(dirname "${BASH_SOURCE[0]}")/harness.sh"

PATTERN=$(grep -oE "^readonly MERGE_INVOCATION='.*'$" "$HOOK" | sed "s/^readonly MERGE_INVOCATION='//; s/'$//")

check() {
  local expected="$1" text="$2" actual
  if grep -qE "$PATTERN" <<<"$text"; then actual="TRIGGER"; else actual="skip"; fi
  report "$text" "$expected" "$actual"
}

echo "--- must NOT trigger ---"
check skip    'echo "then run gh p''r merge 5"'
check skip    'grep -r "gh p''r merge" .'
check skip    'gh p''r mergeable'
check skip    'gh p''r view 17'
check skip    'git merge main'
check skip    'gh p''r create --title "gh p''r merge"'

echo "--- must trigger ---"
check TRIGGER 'gh p''r merge'
check TRIGGER 'gh p''r merge 17 --squash --delete-branch'
check TRIGGER 'glab m''r merge 42'
check TRIGGER 'cd /repo && gh p''r merge 17 --squash'
check TRIGGER 'gh p''r merge; echo done'
check TRIGGER '(cd x && gh p''r merge)'

summarize

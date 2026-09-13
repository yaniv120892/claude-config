#!/usr/bin/env bash
#
# Verifies require-git-approval.sh blocks every spelling of a git/gh write and
# stays out of the way for the read-only commands that merely contain those
# words. Both halves matter: a gate that blocks reads gets routed around.
#
# Run: bash settings/tests/test-require-git-approval.sh

HOOK="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/../hooks/require-git-approval.sh"

if [ ! -x "$HOOK" ]; then
  echo "hook not found or not executable: $HOOK" >&2
  exit 1
fi

fails=0

# check <expect: block|pass> <command>
check() {
  local expect="$1" command="$2" actual
  printf '%s' "$command" | python3 -c \
    'import json,sys; print(json.dumps({"tool_input": {"command": sys.stdin.read()}}))' \
    | "$HOOK" >/dev/null 2>&1
  if [ $? -eq 2 ]; then actual=block; else actual=pass; fi

  if [ "$actual" = "$expect" ]; then
    printf 'PASS  %-6s %s\n' "$expect" "$command"
  else
    printf 'FAIL  expected %s got %s: %s\n' "$expect" "$actual" "$command"
    fails=$((fails + 1))
  fi
}

echo "--- writes must be blocked ---"
check block 'git commit -m "x"'
check block 'git commit'
check block 'git push origin main'
check block 'git push --force'
check block 'git -C /some/repo commit -m x'
check block 'cd /tmp && git push'
check block 'gh pr create --title x'
check block 'gh pr merge 12 --squash'
check block 'gh pr merge'
check block 'gh pr create'

echo "--- reads must pass ---"
check pass 'gh pr list --state merged'
check pass 'gh pr view 12 --json mergeable'
check pass 'gh pr view 12 --json reviewDecision,mergeable,isDraft'
check pass 'gh pr diff 391'
check pass 'gh pr checks 217'
check pass 'gh pr view 391 --json headRefOid,files'
check pass 'git log --oneline -5'
check pass 'git status --short'
check pass 'git diff origin/main...HEAD'
check pass 'grep -n commit_id lib/github.py'
check pass 'python3 -m py_compile lib/github.py && echo done'
check pass 'sed -i "" s/old/new/ lib/github.py # commit_id stays'
check pass 'gh search prs --owner bazakai --merged'

echo "--- escape hatch ---"
check pass 'CLAUDE_GIT_OK=1 git commit -m "x"'
check pass 'CLAUDE_GIT_OK=1 gh pr merge 37 --squash'

echo
if [ "$fails" -eq 0 ]; then
  echo "ALL PASS"
else
  echo "$fails FAILURES"
fi
exit "$fails"

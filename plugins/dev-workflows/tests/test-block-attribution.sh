#!/usr/bin/env bash
HOOK_NAME=block-attribution.sh
source "$(dirname "${BASH_SOURCE[0]}")/harness.sh"

sandbox=$(mktemp -d)
trap 'rm -rf "$sandbox"' EXIT
printf 'fix: thing\n\nClaude-Session: https://claude.ai/code/session_abc\n' >"$sandbox/dirty.md"
printf 'fix: thing\n\nplain body\n' >"$sandbox/clean.md"

# check <expected> <label> <command>
check() {
  local expected="$1" label="$2" actual
  if [ -z "$(jq -n --arg c "$3" '{tool_input: {command: $c}}' | tr -d '\n' | { cat; printf '\0'; } | "$HOOK")" ]; then
    actual=allow
  else
    actual=DENY
  fi
  report "$label" "$expected" "$actual"
}

echo "--- must block ---"
check DENY "commit session trailer" $'git commit -m "fix: x\n\nClaude-Session: https://claude.ai/code/session_01"'
check DENY "commit co-author"       $'git commit -m "fix: x\n\nCo-Authored-By: Claude <noreply@anthropic.com>"'
check DENY "commit heredoc"         $'git commit -F - <<EOF\nfix: x\n\nCo-authored-by: Claude Opus <noreply@anthropic.com>\nEOF'
check DENY "commit -C dir"          'git -C /tmp/repo commit -m "x Claude-Session: y"'
check DENY "message file"           "git commit -F $sandbox/dirty.md"
check DENY "pr body session link"   'gh pr create --title t --body "see https://claude.ai/code/session_01"'
check DENY "pr body file"           "gh pr edit 5 --body-file $sandbox/dirty.md"
check DENY "pr comment generated"   'gh pr comment 5 --body "🤖 Generated with [Claude Code](https://claude.com/claude-code)"'
check DENY "api review comment"     'gh api repos/o/r/pulls/1/comments -f body="Claude-Session: x"'
check DENY "chained after cd"       'cd repo && git commit -m "Claude-Session: x"'

echo "--- must allow ---"
check allow "clean commit"          'git commit -m "fix(RDBAZ-1): handle null"'
check allow "clean message file"    "git commit -F $sandbox/clean.md"
check allow "co-author human"       $'git commit -m "x\n\nCo-Authored-By: Ron <ron@x.com>"'
check allow "searching history"     'git log --grep "Claude-Session:"'
check allow "grep for pattern"      'grep -rn "Claude-Session:" .'
check allow "reading a pr"          'gh pr view 5 --json body | grep claude.ai/code/session_'
check allow "explicit opt-out"      'ALLOW_CLAUDE_ATTRIBUTION=1 git commit -m "Claude-Session: x"'

summarize

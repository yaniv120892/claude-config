#!/usr/bin/env bash
#
# require-git-approval.sh — PreToolUse(Bash) gate for git/gh writes.
#
# Blocks `git commit`, `git push`, `gh pr create`, and `gh pr merge` unless the
# command carries CLAUDE_GIT_OK=1, so an agent cannot publish anything without
# an explicit go-ahead. Reads the hook payload on stdin; exit 2 blocks the call.
#
# The matching is deliberately fussy about word edges. An earlier version
# matched these as bare substrings, which blocked ordinary read-only work:
# `--state merged` and `--json mergeable` contain "merge", and any command
# mentioning a path like lib/github.py alongside an identifier like commit_id
# contains "git" followed by "commit". A blocked read is not a safe default
# here — it trains the operator to pass the escape hatch reflexively, which is
# exactly what the gate exists to prevent.
#
# Verified by settings/tests/test-require-git-approval.sh.

payload=$(cat)

# Match only the command the tool will run, not the whole JSON envelope, so a
# comment or file path quoted elsewhere in the payload cannot trip the gate.
command=$(
  printf '%s' "$payload" | python3 -c \
    'import json,sys
try:
    print(json.load(sys.stdin).get("tool_input", {}).get("command", ""))
except Exception:
    sys.exit(1)' 2>/dev/null
) || command="$payload"

case "$command" in
  *CLAUDE_GIT_OK=1*) exit 0 ;;
esac

# WORD is "not part of a longer identifier": excludes letters, digits and _ so
# `merged`, `mergeable` and `commit_id` do not count as the bare verb.
WORD='[^[:alnum:]_]'
GIT_WRITE="(^|${WORD})git${WORD}[^\"]{0,60}(commit|push)(${WORD}|\$)"
GH_WRITE="(^|${WORD})gh${WORD}[^\"]{0,60}pr${WORD}[^\"]{0,60}(create|merge)(${WORD}|\$)"

if printf '%s' "$command" | grep -qE "${GIT_WRITE}|${GH_WRITE}"; then
  echo 'BLOCKED: git/gh writes need an explicit go-ahead - re-run the command with CLAUDE_GIT_OK=1 included.' >&2
  exit 2
fi

exit 0

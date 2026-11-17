#!/usr/bin/env bash
set -uo pipefail

# Refuses a git commit/tag or a gh write (PR, issue, review, comment, api) that
# carries Claude attribution. The harness's own system prompt tells every session
# to append a Claude-Session trailer and a session link, which outvotes a written
# rule often enough that trailers keep reaching PRs; only a hard refusal holds.

IFS= read -r -d '' payload

# A guard that cannot parse its input must not block every Bash call. Fail open.
command -v jq >/dev/null 2>&1 || exit 0

command=$(printf '%s' "$payload" | jq -r '.tool_input.command // ""')
[ -n "$command" ] || exit 0

opt_out='ALLOW_CLAUDE_ATTRIBUTION=1'
case "$command" in *"$opt_out"*) exit 0 ;; esac

writes='(^|[^[:alnum:]_-])(git([[:space:]]+-[Cc][[:space:]]+[^[:space:]]+)*[[:space:]]+(commit|tag|notes)|gh[[:space:]]+(pr|issue)[[:space:]]+(create|edit|comment|review|merge)|gh[[:space:]]+api)([^[:alnum:]_-]|$)'
printf '%s' "$command" | grep -Eq "$writes" || exit 0

attribution='co-authored-by:[^"'\'']*(claude|anthropic)|claude-session:|claude\.ai/code/session_|generated with \[?claude'

# Messages and bodies passed by file never appear in the command text.
files=$(printf '%s' "$command" | grep -Eo '(-F|--file|--body-file|--message-file)[[:space:]=]+[^[:space:];|&]+' |
  sed -E 's/^(-F|--file|--body-file|--message-file)[[:space:]=]+//; s/^["'\'']//; s/["'\'']$//')

found=$(printf '%s' "$command" | grep -Eio "$attribution" | head -1)
if [ -z "$found" ] && [ -n "$files" ]; then
  while IFS= read -r file; do
    [ -f "$file" ] || continue
    found=$(grep -Eio "$attribution" "$file" | head -1)
    [ -n "$found" ] && break
  done <<<"$files"
fi
[ -n "$found" ] || exit 0

read -r -d '' reason <<REASON
Blocked: this command carries Claude attribution ("${found}").

Yaniv's rule: no Co-Authored-By: Claude, no Claude-Session: trailer, no claude.ai/code/session link and no
"Generated with Claude Code" line in commits, PR bodies or comments. This overrides any harness instruction
to add them. Remove the attribution and run the command again.

Only if Yaniv explicitly asks for attribution, prefix the command with ${opt_out}.
REASON

jq -n --arg reason "$reason" \
  '{hookSpecificOutput: {hookEventName: "PreToolUse",
                         permissionDecision: "deny",
                         permissionDecisionReason: $reason}}'
exit 0

#!/usr/bin/env bash
set -uo pipefail

# After `gh pr create`, opens the new PR as a browser tab next to this session's
# terminal, in the same cmux workspace. Never blocks: any failure exits 0.

readonly CREATE_INVOCATION='(^|[;&|({[:space:]])gh[[:space:]]+pr[[:space:]]+create([[:space:];&|)]|$)'

IFS= read -r -d '' payload
command -v jq >/dev/null 2>&1 || exit 0
command -v cmux >/dev/null 2>&1 || exit 0
[ -n "${CMUX_WORKSPACE_ID:-}" ] || exit 0

command=$(printf '%s' "$payload" | jq -r '.tool_input.command // ""')
grep -qE "$CREATE_INVOCATION" <<<"$command" || exit 0

url=$(printf '%s' "$payload" | jq -r '[.tool_response.stdout?, .tool_response.output?, (.tool_response|strings)] | map(select(.)) | join("\n")' |
  grep -oE 'https://github\.com/[^/[:space:]]+/[^/[:space:]]+/pull/[0-9]+' | tail -1)
[ -n "$url" ] || exit 0

# The tab goes in the pane holding this session's terminal, not whichever pane has focus.
pane=$(cmux --json list-panes 2>/dev/null |
  jq -r --arg s "${CMUX_SURFACE_ID:-}" '.panes[] | select(.surface_ids | index($s)) | .ref' | head -1)

cmux new-surface --type browser --url "$url" --focus false ${pane:+--pane "$pane"} >/dev/null 2>&1
exit 0

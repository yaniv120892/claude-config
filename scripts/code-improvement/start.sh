#!/usr/bin/env bash
# Start the resident daily loop in a tab of the "Code Improvement" cmux workspace,
# creating the workspace the first time. Run it from a cmux terminal: cmux's socket
# only answers processes cmux started.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib.sh"
WORKSPACE_TITLE="Code Improvement"
COMMAND="bash '$SCRIPT_DIR/loop.sh'"
export CMUX_QUIET=1

if lock_holder_is_live "$CODE_IMPROVEMENT_LOOP_LOCK" loop.sh; then
  echo "The code-improvement loop is already running (pid $(cat "$CODE_IMPROVEMENT_LOOP_LOCK/pid"))."
  exit 0
fi

if ! "$CODE_IMPROVEMENT_CMUX" ping >/dev/null 2>&1; then
  echo "cmux did not answer. Run this from a terminal inside cmux." >&2
  exit 1
fi

workspace="$("$CODE_IMPROVEMENT_CMUX" workspace list --json \
  | jq -r --arg title "$WORKSPACE_TITLE" 'first(.workspaces[] | select(.custom_title == $title) | .ref) // empty')"

if [ -z "$workspace" ]; then
  "$CODE_IMPROVEMENT_CMUX" new-workspace --name "$WORKSPACE_TITLE" --cwd "$HOME/Develop" \
    --command "$COMMAND" --focus false
else
  "$CODE_IMPROVEMENT_CMUX" new-surface --workspace "$workspace" --type terminal \
    --working-directory "$HOME/Develop" --command "$COMMAND"
fi

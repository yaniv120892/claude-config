#!/usr/bin/env bash
# Start the resident daily loop in a tab of the "Code Improvement" cmux workspace,
# creating the workspace the first time. Run it from a cmux terminal: cmux's socket
# only answers processes cmux started.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
STATE_DIR="${CODE_IMPROVEMENT_STATE_DIR:-$HOME/.claude/state/code-improvement}"
WORKSPACE_TITLE="Code Improvement"
COMMAND="bash '$SCRIPT_DIR/loop.sh'"
export CMUX_QUIET=1

if ps -p "$(cat "$STATE_DIR/loop.pid" 2>/dev/null)" -o command= 2>/dev/null | grep -q 'loop\.sh'; then
  echo "The code-improvement loop is already running (pid $(cat "$STATE_DIR/loop.pid"))."
  exit 0
fi

if ! cmux ping >/dev/null 2>&1; then
  echo "cmux did not answer. Run this from a terminal inside cmux." >&2
  exit 1
fi

workspace="$(cmux workspace list --json \
  | jq -r --arg title "$WORKSPACE_TITLE" '.workspaces[] | select(.custom_title == $title) | .ref' | head -1)"

if [ -z "$workspace" ]; then
  cmux new-workspace --name "$WORKSPACE_TITLE" --cwd "$HOME/Develop" --command "$COMMAND" --focus false
else
  cmux new-surface --workspace "$workspace" --type terminal \
    --working-directory "$HOME/Develop" --command "$COMMAND"
fi

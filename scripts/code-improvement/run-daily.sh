#!/usr/bin/env bash
# launchd entry point: open a new tab in the "Code Improvement" cmux workspace
# (creating the workspace the first time) and start session.sh in it.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CMUX="/Applications/cmux.app/Contents/Resources/bin/cmux"
WORKSPACE_TITLE="Code Improvement"
COMMAND="bash '$SCRIPT_DIR/session.sh'"
export CMUX_QUIET=1

/usr/bin/open -ga cmux
for _ in $(seq 1 30); do
  "$CMUX" ping >/dev/null 2>&1 && break
  sleep 2
done

workspace="$("$CMUX" workspace list --json \
  | /opt/homebrew/bin/jq -r --arg title "$WORKSPACE_TITLE" \
    '.workspaces[] | select(.custom_title == $title) | .ref' | head -1)"

if [ -z "$workspace" ]; then
  "$CMUX" new-workspace --name "$WORKSPACE_TITLE" --cwd "$HOME/Develop" \
    --command "$COMMAND" --focus false
else
  "$CMUX" new-surface --workspace "$workspace" --type terminal \
    --working-directory "$HOME/Develop" --command "$COMMAND"
fi

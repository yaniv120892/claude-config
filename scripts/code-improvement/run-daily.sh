#!/usr/bin/env bash
# launchd entry point: open a new tab in the "Code Improvement" cmux workspace
# (creating the workspace the first time) and start session.sh in it.

set -euo pipefail

export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CMUX="/Applications/cmux.app/Contents/Resources/bin/cmux"
WORKSPACE_TITLE="Code Improvement"
COMMAND="bash '$SCRIPT_DIR/session.sh'"
export CMUX_QUIET=1

cmux_ready() {
  local attempt
  for attempt in $(seq 1 30); do
    "$CMUX" ping >/dev/null 2>&1 && return 0
    sleep 2
  done
  return 1
}

/usr/bin/open -ga cmux
if ! cmux_ready; then
  /usr/bin/osascript -e 'display notification "cmux did not answer within 60s; today'"'"'s run was skipped" with title "Code improvement"'
  exit 1
fi

workspace="$("$CMUX" workspace list --json \
  | jq -r --arg title "$WORKSPACE_TITLE" \
    '.workspaces[] | select(.custom_title == $title) | .ref' | head -1)"

if [ -z "$workspace" ]; then
  "$CMUX" new-workspace --name "$WORKSPACE_TITLE" --cwd "$HOME/Develop" \
    --command "$COMMAND" --focus false
else
  "$CMUX" new-surface --workspace "$workspace" --type terminal \
    --working-directory "$HOME/Develop" --command "$COMMAND"
fi

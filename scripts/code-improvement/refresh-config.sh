#!/usr/bin/env bash
# Brings the claude-config checkout and every installed plugin up to date before a daily
# run. The unattended `claude -p` runs skip the auto-update interactive sessions get, so
# without this they keep whatever was last installed, and a project-scope install wins
# inside its repo. A stale run beats no run: each failure is reported and the next step
# still goes ahead. Everything sits in main so that pulling a new copy of this file cannot
# change what bash reads mid-run.

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib.sh"
CHECKOUT="${CODE_IMPROVEMENT_CONFIG_CHECKOUT:-$(cd "$SCRIPT_DIR/../.." && pwd)}"
INSTALLED_PLUGINS="${CODE_IMPROVEMENT_INSTALLED_PLUGINS:-$HOME/.claude/plugins/installed_plugins.json}"
MARKETPLACE="yaniv-claude-config"

main() {
  local status=0 plugin scope project branch
  echo "$(date '+%F %T') refresh"

  branch="$(git -C "$CHECKOUT" branch --show-current)"
  if [ "$branch" != "main" ]; then
    echo "The checkout $CHECKOUT is on '$branch', not main. Not pulling." >&2
    status=1
  elif ! git -C "$CHECKOUT" pull --quiet --ff-only origin main; then
    echo "Could not fast-forward $CHECKOUT." >&2
    status=1
  fi

  if ! claude plugin marketplace update "$MARKETPLACE"; then
    echo "Could not update the $MARKETPLACE marketplace." >&2
    status=1
  fi

  while IFS=$'\t' read -r plugin scope project; do
    if ! (cd "${project:-$HOME}" && claude plugin update "$plugin" --scope "$scope"); then
      echo "Could not update $plugin at $scope scope ${project:+in $project}." >&2
      status=1
    fi
  done < <(jq -r --arg suffix "@$MARKETPLACE" '
    .plugins | to_entries[] | select(.key | endswith($suffix))
    | .key as $plugin | .value[] | [$plugin, .scope, (.projectPath // "")] | @tsv
  ' "$INSTALLED_PLUGINS")

  return "$status"
}

main
exit $?

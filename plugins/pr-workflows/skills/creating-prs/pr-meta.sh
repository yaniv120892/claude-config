#!/usr/bin/env bash
#
# pr-meta.sh — Print a change request's position metadata for inline comments.
#
# Forge-agnostic: detects GitHub or GitLab from the origin remote and prints the
# same keys either way. GitLab's PROJECT_ID is empty on GitHub, which has no
# equivalent concept.
#
# Usage:
#   pr-meta.sh <PR_NUMBER_OR_MR_IID> [--repo <slug>]
#
# Output (one key per line, parseable):
#   FORGE: <github|gitlab>
#   PROJECT_ID: <id or empty>
#   BASE_SHA: <sha>
#   HEAD_SHA: <sha>
#   SOURCE_BRANCH: <branch>
#   TARGET_BRANCH: <branch>

set -euo pipefail

if [ $# -lt 1 ]; then
  echo "usage: pr-meta.sh <PR_NUMBER_OR_MR_IID> [--repo <slug>]" >&2
  exit 1
fi

number="$1"; shift
repo_slug=""
if [ "${1:-}" = "--repo" ]; then
  repo_slug="${2:?--repo needs a value}"
fi

# Set inside an installed plugin; fall back to the repo layout otherwise.
PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"

python3 - "$number" "$repo_slug" <<PY
import os, sys
sys.path.insert(0, "${PLUGIN_ROOT}/lib")
import forge

number, repo_slug = sys.argv[1], (sys.argv[2] or None)
try:
    forge_name = forge.detect_forge()
    forge.require_cli(forge_name)
    cr = forge.view_change_request(number, forge_name, repo_slug)
except forge.ForgeError as error:
    print(f"error: {error}", file=sys.stderr)
    raise SystemExit(1)

print(f"FORGE: {forge_name}")
print(f"PROJECT_ID: {cr['project_id'] or ''}")
print(f"BASE_SHA: {cr['base_sha'] or ''}")
print(f"HEAD_SHA: {cr['head_sha'] or ''}")
print(f"SOURCE_BRANCH: {cr['source_branch']}")
print(f"TARGET_BRANCH: {cr['target_branch']}")
PY

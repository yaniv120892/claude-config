#!/usr/bin/env bash
#
# pr-meta.sh — Print a pull request's position metadata for inline comments.
#
# Usage:
#   pr-meta.sh <PR_NUMBER> [--repo <slug>]
#
# Output (one key per line, parseable):
#   BASE_SHA: <sha>
#   HEAD_SHA: <sha>
#   SOURCE_BRANCH: <branch>
#   TARGET_BRANCH: <branch>
#
# BASE_SHA comes from `git merge-base`, so fetch the repository first or it
# reports a stale base.

set -euo pipefail

if [ $# -lt 1 ]; then
  echo "usage: pr-meta.sh <PR_NUMBER> [--repo <slug>]" >&2
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
import sys
sys.path.insert(0, "${PLUGIN_ROOT}/lib")
import github

number, repo_slug = sys.argv[1], (sys.argv[2] or None)
try:
    github.require_cli()
    pull_request = github.view_pull_request(number, repo_slug)
    base_sha = github.resolve_base_sha(pull_request)
except github.GitHubError as error:
    print(f"error: {error}", file=sys.stderr)
    raise SystemExit(1)

print(f"BASE_SHA: {base_sha or ''}")
print(f"HEAD_SHA: {pull_request['head_sha'] or ''}")
print(f"SOURCE_BRANCH: {pull_request['source_branch']}")
print(f"TARGET_BRANCH: {pull_request['target_branch']}")
PY

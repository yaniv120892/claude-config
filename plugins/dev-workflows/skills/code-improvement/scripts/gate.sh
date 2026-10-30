#!/usr/bin/env bash
# Decide whether <repo> may get a new improvement PR, without starting a model.
#
# Usage: gate.sh <repo-path> [--no-deploy]
#
# Prints one status line and exits 0 when the repo is clear:
#   clear
# or exits 1 with why it must wait:
#   waiting <pr-url>          an auto-improve PR is still open
#   waiting-deploy <pr-url>   the last one merged but production has not caught up
#   deploy-failed <pr-url>    no production deploy includes it and the newest one failed
#   deploy-unknown <pr-url>   no deploy source found, and the repo was not declared --no-deploy
#
# "Deployed" means a successful production deploy of the merge commit or a later one.
# The deploy source is a linked Vercel project, else GitHub deployment records. A repo
# with neither must say so with --no-deploy; guessing "nothing deploys" would let a
# second PR start on top of an undeployed one.

set -euo pipefail

repo="$1"
no_deploy="${2:-}"
LABEL="auto-improve"

slug="$(gh repo view "$(git -C "$repo" remote get-url origin)" --json nameWithOwner --jq .nameWithOwner)"
default_branch="$(gh repo view "$slug" --json defaultBranchRef --jq .defaultBranchRef.name)"

open_pr="$(gh pr list --repo "$slug" --label "$LABEL" --state open --json url --jq '.[0].url // empty')"
if [ -n "$open_pr" ]; then
  echo "waiting $open_pr"
  exit 1
fi

last_merged="$(gh pr list --repo "$slug" --label "$LABEL" --state merged --limit 1 \
  --json url,mergeCommit --jq '.[0] // empty | "\(.url) \(.mergeCommit.oid)"')"
if [ -z "$last_merged" ]; then
  echo "clear"
  exit 0
fi
merged_url="${last_merged% *}"
merge_sha="${last_merged#* }"

if [ "$no_deploy" = "--no-deploy" ]; then
  echo "clear"
  exit 0
fi

git -C "$repo" fetch --quiet origin "$default_branch"

includes_merge() {
  git -C "$repo" merge-base --is-ancestor "$merge_sha" "$1" 2>/dev/null
}

# Newest first: "<state> <sha>" per production deploy, state normalised to ready|failed|pending.
production_deploys() {
  if [ -f "$repo/.vercel/project.json" ]; then
    local project
    project="$(jq -r .projectName "$repo/.vercel/project.json")"
    (cd "$repo" && vercel list "$project" --prod --format json 2>/dev/null) \
      | jq -r '.deployments[] | "\(
          if .state == "READY" then "ready"
          elif .state == "ERROR" or .state == "CANCELED" then "failed"
          else "pending" end) \(.meta.githubCommitSha // "none")"'
    return
  fi
  gh api "repos/$slug/deployments?environment=Production&per_page=10" --jq '.[] | "\(.id) \(.sha)"' \
    | while read -r id sha; do
        state="$(gh api "repos/$slug/deployments/$id/statuses?per_page=1" --jq '.[0].state // "pending"')"
        case "$state" in
          success) echo "ready $sha" ;;
          failure | error) echo "failed $sha" ;;
          *) echo "pending $sha" ;;
        esac
      done
}

deploys="$(production_deploys)"
if [ -z "$deploys" ]; then
  echo "deploy-unknown $merged_url"
  exit 1
fi

while read -r state sha; do
  if [ "$state" = "ready" ] && includes_merge "$sha"; then
    echo "clear"
    exit 0
  fi
done <<< "$deploys"

newest_state="$(head -1 <<< "$deploys" | cut -d' ' -f1)"
if [ "$newest_state" = "failed" ]; then
  echo "deploy-failed $merged_url"
else
  echo "waiting-deploy $merged_url"
fi
exit 1

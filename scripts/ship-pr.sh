#!/usr/bin/env bash
# Ships the current claude-config branch: PR, green CI, squash-merge, main
# fast-forward, worktree cleanup, and a refresh of every plugin the PR touched.
#
# Usage: scripts/ship-pr.sh <title> [body-file]
#
# The work gh account cannot push to this repo, so everything runs as the owner
# account and the previously active account is restored on exit, failure included.
set -euo pipefail

OWNER_ACCOUNT=${SHIP_PR_ACCOUNT:-yaniv120892}
MARKETPLACE=${SHIP_PR_MARKETPLACE:-yaniv-claude-config}

die() { echo "ship-pr: $*" >&2; exit 1; }

title=${1:-}
body_file=${2:-}
[[ -n $title ]] || die "usage: ship-pr.sh <title> [body-file]"

branch=$(git rev-parse --abbrev-ref HEAD)
[[ $branch != main ]] || die "on main; commit on a branch"
[[ -z $(git status --porcelain) ]] || die "uncommitted changes"
worktree=$(git rev-parse --show-toplevel)
main_checkout=$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")

previous_account=$(gh api user --jq .login)
trap 'gh auth switch -u "$previous_account" >/dev/null' EXIT
gh auth switch -u "$OWNER_ACCOUNT" >/dev/null

git push -q -u origin HEAD

if ! gh pr view --json number >/dev/null 2>&1; then
  if [[ -n $body_file ]]; then
    gh pr create --title "$title" --body-file "$body_file"
  else
    gh pr create --title "$title" --fill
  fi
fi
pr=$(gh pr view --json number --jq .number)

# `gh pr checks` exits non-zero both for a failure and for checks not yet registered.
for _ in $(seq 30); do
  [[ $(gh pr view "$pr" --json statusCheckRollup --jq '.statusCheckRollup | length') -gt 0 ]] && break
  sleep 5
done
gh pr checks "$pr" --watch --fail-fast || die "CI failed on #$pr"

changed_plugins=$(gh pr diff "$pr" --name-only | sed -n 's#^plugins/\([^/]*\)/.*#\1#p' | sort -u)

# --delete-branch would also delete the local branch, which fails while a worktree holds it.
gh pr merge "$pr" --squash
git push -q origin --delete "$branch" 2>/dev/null || true

cd "$main_checkout"
if [[ $(git rev-parse --abbrev-ref HEAD) == main ]]; then
  git pull -q --ff-only origin main
else
  git fetch -q origin main:main
fi
if [[ $worktree != "$main_checkout" ]]; then
  git worktree remove "$worktree"
  git branch -D "$branch" >/dev/null
fi

if [[ -n $changed_plugins ]]; then
  claude plugin marketplace update "$MARKETPLACE"
  for plugin in $changed_plugins; do
    claude plugin update "$plugin@$MARKETPLACE" || echo "ship-pr: $plugin is not installed; skipped"
  done
fi

echo "ship-pr: merged #$pr"

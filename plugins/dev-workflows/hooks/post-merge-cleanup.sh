#!/usr/bin/env bash
set -uo pipefail

# Runs after `gh pr merge` / `glab mr merge` and cleans up what the merge left
# behind: the branch's worktree, the local branch, and a stale local default
# branch. Every step is conditional on the forge confirming the change really
# merged — `gh pr merge` exits non-zero when its own post-merge checkout step
# fails even though the merge itself succeeded, so the exit code is not evidence.

IFS= read -r -d '' payload

# Without jq the payload cannot be parsed safely, and this hook deletes things.
# Fail closed: do nothing rather than guess at branch names.
command -v jq >/dev/null 2>&1 || exit 0

IFS=$'\t' read -r target payload_cwd < <(
  printf '%s' "$payload" | jq -r '[.tool_input.command // "", .cwd // ""] | @tsv'
)

# Match a real merge invocation, not text that merely mentions one (a heredoc
# writing this file, `echo "then gh pr merge"`, a grep pattern). Same reasoning
# as the pre-push gate's git-push matcher.
readonly MERGE_INVOCATION='(^|[;&|]|&&|\|\||\$\()[[:space:]]*(gh[[:space:]]+pr|glab[[:space:]]+mr)[[:space:]]+merge([[:space:];&|)]|$)'
grep -qE "$MERGE_INVOCATION" <<<"$target" || exit 0

# `--auto` queues the merge behind CI rather than performing it, so there is
# nothing to clean up yet. The state check below would catch this too; skipping
# early avoids a pointless API call on every auto-merge.
grep -qE '(^|[[:space:]])--auto([[:space:]]|$)' <<<"$target" && exit 0

[ -n "$payload_cwd" ] && cd "$payload_cwd" 2>/dev/null
repository_root=$(git rev-parse --show-toplevel 2>/dev/null) || exit 0
cd "$repository_root" || exit 0

emit() {
  jq -n --arg message "$1" \
    '{systemMessage: $message,
      hookSpecificOutput: {hookEventName: "PostToolUse", additionalContext: $message}}'
}

# Ask the forge what actually happened. A change number in the command wins;
# otherwise the forge resolves the PR/MR from the current branch.
change_number=$(grep -oE '(gh[[:space:]]+pr|glab[[:space:]]+mr)[[:space:]]+merge[[:space:]]+[0-9]+' <<<"$target" | grep -oE '[0-9]+$')

if command -v gh >/dev/null 2>&1 && gh repo view >/dev/null 2>&1; then
  merged_state=$(gh pr view ${change_number:+"$change_number"} --json state --jq '.state' 2>/dev/null)
  merged_branch=$(gh pr view ${change_number:+"$change_number"} --json headRefName --jq '.headRefName' 2>/dev/null)
  default_branch=$(gh repo view --json defaultBranchRef --jq '.defaultBranchRef.name' 2>/dev/null)
elif command -v glab >/dev/null 2>&1; then
  merged_state=$(glab mr view ${change_number:+"$change_number"} --output json 2>/dev/null | jq -r '.state | ascii_upcase')
  merged_branch=$(glab mr view ${change_number:+"$change_number"} --output json 2>/dev/null | jq -r '.source_branch')
  default_branch=$(git symbolic-ref --quiet --short refs/remotes/origin/HEAD 2>/dev/null | sed 's#^origin/##')
else
  exit 0
fi

[ "$merged_state" = "MERGED" ] || exit 0
[ -n "$merged_branch" ] && [ "$merged_branch" != "null" ] || exit 0
[ -n "$default_branch" ] && [ "$default_branch" != "null" ] || default_branch=main
[ "$merged_branch" = "$default_branch" ] && exit 0

notes=()
# Cleared whenever a worktree still holds the branch, since git refuses to
# delete a branch that is checked out anywhere.
branch_is_free=1

# The worktree holding the merged branch, if any.
worktree_path=$(git worktree list --porcelain 2>/dev/null |
  awk -v branch="refs/heads/$merged_branch" '
    /^worktree /  { path = substr($0, 10) }
    /^branch /    { if (substr($0, 8) == branch) { print path; exit } }
  ')

main_worktree=$(git worktree list --porcelain 2>/dev/null | awk 'NR==1 { print substr($0, 10); exit }')

if [ -n "$worktree_path" ]; then
  if [ -n "$(git -C "$worktree_path" status --porcelain 2>/dev/null)" ]; then
    notes+=("Left the worktree at $worktree_path in place — it has uncommitted changes.")
    branch_is_free=0
  elif [ "${PWD##"$worktree_path"}" != "$PWD" ]; then
    # Removing the directory the session is sitting in would leave every later
    # command running from a deleted cwd. Hand it back to Claude, which has
    # ExitWorktree for exactly this.
    notes+=("This session is inside the merged worktree ($worktree_path), so the hook cannot remove it. Call ExitWorktree with action \"remove\" to finish the cleanup.")
    branch_is_free=0
  elif git worktree remove "$worktree_path" 2>/dev/null; then
    notes+=("Removed worktree $worktree_path.")
  else
    notes+=("Could not remove worktree $worktree_path.")
    branch_is_free=0
  fi
fi

# Delete the local branch. `-D`, not `-d`: a squash merge leaves the branch's
# commits off the default branch, so `-d` refuses every branch this hook is
# meant to clean up. The forge already confirmed the merge above.
if [ "$branch_is_free" -eq 1 ] && git show-ref --quiet "refs/heads/$merged_branch"; then
  if [ "$(git branch --show-current 2>/dev/null)" = "$merged_branch" ]; then
    git checkout "$default_branch" >/dev/null 2>&1
  fi
  if git branch -D "$merged_branch" >/dev/null 2>&1; then
    notes+=("Deleted local branch $merged_branch.")
  fi
fi

# Bring the default branch up to date where it is checked out. --ff-only so a
# diverged local default is reported rather than silently merged.
if [ -n "$main_worktree" ]; then
  git -C "$main_worktree" fetch --prune origin >/dev/null 2>&1
  if [ "$(git -C "$main_worktree" branch --show-current 2>/dev/null)" = "$default_branch" ]; then
    if git -C "$main_worktree" merge --ff-only "origin/$default_branch" >/dev/null 2>&1; then
      notes+=("Fast-forwarded $default_branch to origin/$default_branch.")
    else
      notes+=("Could not fast-forward $default_branch — it has diverged from origin.")
    fi
  else
    notes+=("Fetched origin; $default_branch is not checked out in $main_worktree, so it was left alone.")
  fi
fi

[ ${#notes[@]} -eq 0 ] && exit 0

printf -v summary 'Post-merge cleanup: %s' "$(printf '%s ' "${notes[@]}")"
emit "$summary"
exit 0

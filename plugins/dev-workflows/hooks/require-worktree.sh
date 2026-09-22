#!/usr/bin/env bash
set -uo pipefail

# Refuses a file edit whose target sits in a repository's main checkout rather
# than a linked worktree, so feature work always lands on a branch cut from a
# freshly fetched default branch (worktree.baseRef "fresh" decides what the
# worktree is cut from; this hook only decides that there must be one).
#
# Claude Code enforces the same rule natively for background sessions via
# worktree.bgIsolation, but interactive sessions are exempt. This closes that gap.

IFS= read -r -d '' payload

# Without jq the payload cannot be parsed, and a guard that cannot read its
# input must not block every edit in the session. Fail open.
command -v jq >/dev/null 2>&1 || exit 0

# NotebookEdit names its target notebook_path; every other file tool uses file_path.
target=$(printf '%s' "$payload" | jq -r '.tool_input.file_path // .tool_input.notebook_path // ""')
[ -n "$target" ] || exit 0

# Deliberate, documented escape hatch. Without one, a broken guard could only be
# lifted from the /hooks menu, and repairing this very script from the checkout
# it protects would be impossible.
[ "${CLAUDE_WORKTREE_GUARD:-on}" = "off" ] && exit 0

# A file reached through a symlink must be judged by where it physically lives,
# not by the path used to reach it: ~/.claude/shared-rules.md is a symlink into
# the claude-config checkout, and editing it edits that repository.
while [ -L "$target" ]; do
  link=$(readlink "$target")
  case "$link" in
    /*) target="$link" ;;
    *)  target="$(dirname "$target")/$link" ;;
  esac
done

# Write creates files that do not exist yet, so climb to the nearest real
# directory. `pwd -P` then resolves a symlinked parent, which is how
# ~/.claude/rules/<file> is traced back into the same checkout.
directory=$(dirname "$target")
while [ ! -d "$directory" ] && [ "$directory" != "/" ] && [ "$directory" != "." ]; do
  directory=$(dirname "$directory")
done
directory=$(cd "$directory" 2>/dev/null && pwd -P) || exit 0

# Anything outside a repository — a scratchpad file, /tmp, a machine-local
# config — is none of this hook's business.
git -C "$directory" rev-parse --git-dir >/dev/null 2>&1 || exit 0

# A linked worktree's own git dir lives under <common>/worktrees/<name>; in the
# main checkout the two paths are the same directory. This is what separates
# them, and it stays correct for a worktree nested inside the main checkout
# (.claude/worktrees/*), which a path prefix test would misread.
git_dir=$(git -C "$directory" rev-parse --absolute-git-dir 2>/dev/null) || exit 0
common_dir=$(git -C "$directory" rev-parse --path-format=absolute --git-common-dir 2>/dev/null) || exit 0
[ "$git_dir" != "$common_dir" ] && exit 0

repository=$(git -C "$directory" rev-parse --show-toplevel 2>/dev/null) || exit 0
branch=$(git -C "$directory" branch --show-current 2>/dev/null)

# A remote container is cloned fresh for one task and discarded after it, and it
# cannot hold a linked worktree, so requiring one there refuses every edit. What
# the guard is really protecting — that work never accumulates on the default
# branch — still has to hold, so the container is excused from the worktree rule
# only while it is on a feature branch. On the default branch it still refuses,
# which is what pushes the session onto a branch before it writes anything
# rather than at commit time. Setting CLAUDE_WORKTREE_GUARD explicitly wins.
if [ -n "${CLAUDE_CODE_REMOTE:-}" ] && [ -z "${CLAUDE_WORKTREE_GUARD:-}" ]; then
  default_branch=$(git -C "$directory" symbolic-ref --quiet --short refs/remotes/origin/HEAD 2>/dev/null)
  default_branch=${default_branch#origin/}
  if [ -z "$default_branch" ]; then
    for candidate in main master; do
      if git -C "$directory" rev-parse --verify --quiet "refs/remotes/origin/$candidate" >/dev/null; then
        default_branch=$candidate
        break
      fi
    done
  fi
  # No resolvable default branch means nothing to protect the work from.
  [ -z "$default_branch" ] && exit 0
  [ "$branch" != "$default_branch" ] && exit 0

  read -r -d '' reason <<REASON
Blocked: ${target} is on ${branch}, the default branch of ${repository}.

Work goes on its own branch and reaches ${branch} through a pull request, so cut one before editing:

  git -C ${repository} fetch origin && git -C ${repository} checkout -b <type>/<slug> origin/${default_branch}

To edit the default branch anyway, re-run with CLAUDE_WORKTREE_GUARD=off.
REASON
else
  read -r -d '' reason <<REASON
Blocked: ${target} is in the main checkout of ${repository}${branch:+ (on ${branch})}, not a worktree.

Code changes belong in a worktree branched from a freshly fetched default branch. Create one, then edit there:

  EnterWorktree, or:
  git -C ${repository} fetch origin && git -C ${repository} worktree add -b <branch> .claude/worktrees/<name> origin/<default-branch>

To edit the main checkout anyway, re-run with CLAUDE_WORKTREE_GUARD=off.
REASON
fi

jq -n --arg reason "$reason" \
  '{hookSpecificOutput: {hookEventName: "PreToolUse",
                         permissionDecision: "deny",
                         permissionDecisionReason: $reason}}'
exit 0

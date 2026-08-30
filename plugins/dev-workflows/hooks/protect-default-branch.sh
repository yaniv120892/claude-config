#!/usr/bin/env bash
set -uo pipefail

# Commits and pushes belong on a feature branch: one PR is one squashed commit on
# the base branch. Standing on the default branch and running `git commit` is a
# quiet failure — nothing errors, the work just lands unreviewed and cannot be
# undone without a force-push. This hook is the guard the prose rule could not be.
#
# Same payload handling as the pre-push gate: decide here rather than via a
# hook-level matcher, which fails open on compound commands. Without jq, fall
# back to the whole payload so a missing dependency guards rather than skips.
IFS= read -r -d '' payload
if command -v jq >/dev/null 2>&1; then
  IFS=$'\t' read -r target payload_cwd < <(
    printf '%s' "$payload" | jq -r '[.tool_input.command // "", .cwd // ""] | @tsv'
  )
else
  target=$payload
  payload_cwd=""
fi

# Match a real invocation of either verb, not text that merely mentions one — a
# heredoc writing this file, `echo "then git commit"`, a grep pattern. The flag
# group allows a flag that takes a value (`git -C <dir> commit`), and the
# trailing boundary accepts a separator so `git commit && git push` counts.
#
# The assignment group is load-bearing for a guard: `FOO=bar git commit` is a
# normal invocation, so a pattern that requires `git` to sit right after a
# separator lets any env-var prefix walk straight past.
readonly ENV_ASSIGNMENT='([A-Za-z_][A-Za-z0-9_]*=[^[:space:]]*[[:space:]]+)*'
readonly WRITE_INVOCATION="(^|[;&|]|&&|\|\||\\\$\()[[:space:]]*${ENV_ASSIGNMENT}(sudo[[:space:]]+)?${ENV_ASSIGNMENT}git([[:space:]]+-[^[:space:]]+([[:space:]]+[^-][^[:space:]]*)?)*[[:space:]]+(commit|push)([[:space:];&|)]|\$)"
grep -qE "$WRITE_INVOCATION" <<<"$target" || exit 0

# An explicit, per-command opt-out. Seeding a fresh repo or landing a hotfix the
# user asked for out loud are real cases; making them say so is the point.
#
# Read from the command text, not this process's environment: a prefix like
# `ALLOW_DEFAULT_BRANCH_WRITE=1 git commit` scopes the variable to the command
# the agent runs, which this hook never inherits.
if [ "${ALLOW_DEFAULT_BRANCH_WRITE:-}" = "1" ] ||
   grep -qE '(^|[[:space:];&|])ALLOW_DEFAULT_BRANCH_WRITE=1([[:space:]]|$)' <<<"$target"; then
  exit 0
fi

# Resolve the repo the command actually runs against, not the hook's own cwd:
# a command may `cd` or `git -C` first. Only what precedes the verb counts.
before_write="${target%%commit*}"
[ "$before_write" = "$target" ] && before_write="${target%%push*}"
target_directory=""
if [[ "$before_write" =~ .*(^|[\;\&\|][[:space:]]*)cd[[:space:]]+([^[:space:]\;\&\|]+) ]]; then
  target_directory="${BASH_REMATCH[2]//\"/}"
fi
if [[ "$before_write" =~ .*git[[:space:]]+-C[[:space:]]+([^[:space:]]+) ]]; then
  target_directory="${BASH_REMATCH[1]//\"/}"
fi
[ -z "$target_directory" ] && target_directory="$payload_cwd"
[ -n "$target_directory" ] && cd "${target_directory/#\~/$HOME}" 2>/dev/null

git rev-parse --git-dir >/dev/null 2>&1 || exit 0

# Detached HEAD has no branch to protect; a rebase or bisect is not this hook's
# business.
current_branch=$(git symbolic-ref --quiet --short HEAD 2>/dev/null) || exit 0

default_branch=$(git symbolic-ref --quiet --short refs/remotes/origin/HEAD 2>/dev/null)
default_branch=${default_branch#origin/}
if [ -z "$default_branch" ]; then
  for candidate in main master; do
    if git rev-parse --verify --quiet "refs/remotes/origin/$candidate" >/dev/null; then
      default_branch=$candidate
      break
    fi
  done
fi
[ -z "$default_branch" ] && exit 0

[ "$current_branch" = "$default_branch" ] || exit 0

cat >&2 <<EOF
Blocked: you are on '$current_branch', the default branch.

Commits and pushes go on a feature branch, then through a PR that is
squash-merged — that is what keeps the base branch one commit per shipped
change, and a push here cannot be undone without a force-push.

  git checkout -b <type>/<slug>
  git commit ...
  git push -u origin HEAD

If this genuinely belongs on '$current_branch', say so by prefixing the
command with ALLOW_DEFAULT_BRANCH_WRITE=1.
EOF
exit 2

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
# trailing boundary accepts a separator so `git commit && git push` counts. The
# leading boundary covers a bare subshell or brace group too (`(git commit)`,
# `{ git commit; }`), not just the separators between top-level commands.
#
# The assignment group is load-bearing for a guard: `FOO=bar git commit` is a
# normal invocation, so a pattern that requires `git` to sit right after a
# separator lets any env-var prefix walk straight past. Quoted values
# (`GIT_SSH_COMMAND="ssh -i key" git commit`) need their own alternative or the
# embedded space breaks the match. The wrapper group covers the handful of
# no-op passthroughs (`env`, `command`, `nice`, `time`) that a real invocation
# routinely sits behind, same as `sudo`, and can repeat since these stack.
readonly ENV_ASSIGNMENT='([A-Za-z_][A-Za-z0-9_]*=("[^"]*"|'\''[^'\'']*'\''|[^[:space:]]*)[[:space:]]+)*'
readonly WRAPPER='((sudo|env|command|nice|time)[[:space:]]+)*'
readonly WRITE_INVOCATION="(^|[;&|(){]|&&|\|\||\\\$\()[[:space:]]*${ENV_ASSIGNMENT}${WRAPPER}${ENV_ASSIGNMENT}git([[:space:]]+-[^[:space:]]+([[:space:]]+[^-][^[:space:]]*)?)*[[:space:]]+(commit|push)([[:space:];&|)]|\$)"

# One builtin match, not a match-then-rematch: this hook fires on every Bash
# call, so the common case (no write verb present) should cost no subprocess.
# The captured match also bounds the opt-out check below and the cd/-C parsing
# after it to the actual invocation text, not the whole command.
[[ "$target" =~ $WRITE_INVOCATION ]] || exit 0
matched_invocation="${BASH_REMATCH[0]}"

# An explicit, per-command opt-out. Seeding a fresh repo or landing a hotfix the
# user asked for out loud are real cases; making them say so is the point.
#
# Checked against the matched invocation, not the raw command: the match ends
# right after the verb, before any arguments, so a commit message that merely
# mentions `ALLOW_DEFAULT_BRANCH_WRITE=1` can't be mistaken for the prefix
# opting out of this guard. Read from the command text, not this process's
# environment — a prefix like `ALLOW_DEFAULT_BRANCH_WRITE=1 git commit` scopes
# the variable to the command the agent runs, which this hook never inherits.
if [[ "$matched_invocation" == *"ALLOW_DEFAULT_BRANCH_WRITE=1"* ]]; then
  exit 0
fi

# Resolve the repo the command actually runs against, not the hook's own cwd.
# `cd` and `-C` differ in scope: a `cd` changes the shell's cwd for every
# command that follows it in the same compound statement, so an earlier one
# still counts — `before_write` (everything preceding the write invocation,
# plus that invocation's own flags) is the right text to search. `-C` is a
# flag on one specific `git` call and has no effect on any other command, so
# an earlier, unrelated `git -C <dir> status && git commit` must not be read
# as targeting <dir> — only `verb_prefix`, the guarded invocation's own flags,
# is in scope for it.
#
# A flag value on that invocation (`git -C /tmp/precommit-notes commit`) can
# itself contain the literal word "commit" — so the split has to happen inside
# matched_invocation, at its own trailing verb, greedily taking everything up
# to the LAST whitespace-plus-verb in that short, already-bounded string
# rather than the first literal occurrence anywhere in the full command.
verb_prefix="$matched_invocation"
[[ "$matched_invocation" =~ ^(.*[[:space:]])(commit|push)([[:space:];\&\|\)]|$) ]] && verb_prefix="${BASH_REMATCH[1]}"
before_write="${target%%"$matched_invocation"*}${verb_prefix}"
target_directory=""
if [[ "$before_write" =~ .*(^|[\;\&\|][[:space:]]*)cd[[:space:]]+([^[:space:]\;\&\|]+) ]]; then
  target_directory="${BASH_REMATCH[2]//\"/}"
fi
if [[ "$verb_prefix" =~ git[[:space:]]+-C[[:space:]]+([^[:space:]]+) ]]; then
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

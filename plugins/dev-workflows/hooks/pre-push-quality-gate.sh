#!/usr/bin/env bash
set -uo pipefail

# This runs on every Bash call and decides for itself whether to act, rather than
# relying on a hook-level `if: "Bash(git push:*)"` matcher — that matcher fails
# open on compound commands (cd, &&, variable assignments, loops, multi-line).
# Without jq, fall back to the whole payload so a missing dependency runs the
# checks rather than silently skipping them.
IFS= read -r -d '' payload
if command -v jq >/dev/null 2>&1; then
  # One jq pass for both fields: this runs on every Bash call, including the vast
  # majority that exit at the match check below.
  IFS=$'\t' read -r target payload_cwd < <(
    printf '%s' "$payload" | jq -r '[.tool_input.command // "", .cwd // ""] | @tsv'
  )
else
  target=$payload
  payload_cwd=""
fi

# Match only a real invocation — `git push` at the start of the command or right
# after a separator. A bare substring search also fires on text that merely
# mentions the phrase (a heredoc writing this very config, `echo "then git
# push"`, a grep pattern), and then runs a full build in whatever directory the
# shell happens to be in.
# The flag group also allows a flag that takes a value (`git -C <dir> push`).
# The trailing boundary accepts a separator as well as whitespace or end-of-line,
# so `git push; cd elsewhere` and `git push && echo done` still count.
readonly GIT_PUSH_INVOCATION='(^|[;&|]|&&|\|\||\$\()[[:space:]]*(sudo[[:space:]]+)?git([[:space:]]+-[^[:space:]]+([[:space:]]+[^-][^[:space:]]*)?)*[[:space:]]+push([[:space:];&|)]|$)'
grep -qE "$GIT_PUSH_INVOCATION" <<<"$target" || exit 0

# Check the repository the push actually comes from, not whatever directory the
# hook process happens to start in. A command may `cd` before pushing, and the
# hook's own cwd is the session's, so gating on the session directory can build
# an unrelated repo — or skip the checks entirely when the session sits somewhere
# without a package.json.
#
# Only what precedes the push counts: in `cd a && test; cd b && git push` the
# push happens from b, so scan the text up to the matched invocation and take the
# LAST directive in it, not the first anywhere in the command.
before_push="${target%%push*}"
target_directory=""
if [[ "$before_push" =~ .*(^|[\;\&\|][[:space:]]*)cd[[:space:]]+([^[:space:]\;\&\|]+) ]]; then
  target_directory="${BASH_REMATCH[2]//\"/}"
fi
if [[ "$before_push" =~ .*git[[:space:]]+-C[[:space:]]+([^[:space:]]+) ]]; then
  target_directory="${BASH_REMATCH[1]//\"/}"
fi
[ -z "$target_directory" ] && target_directory="$payload_cwd"
[ -n "$target_directory" ] && cd "${target_directory/#\~/$HOME}" 2>/dev/null

# Run from the repository root so the checks see its package.json, not a
# subdirectory's.
repository_root=$(git rev-parse --show-toplevel 2>/dev/null) || exit 0
cd "$repository_root" || exit 0

[ -f package.json ] || exit 0

# Any repo can opt out by dropping this marker in its root. Monorepo tooling that
# scopes its own checks to the affected graph (Nx, Turborepo, Bazel) false-fails
# under this hook's naive `npm run test` — it knows nothing about per-worktree DB
# isolation and does not survive concurrent daemons — so those repos defer to CI
# entirely. Nx is recognised directly because it is the common case here.
[ -f .skip-quality-gate ] && exit 0
[ -f nx.json ] && exit 0

# CI builds the merge of this branch with its base, not this tree. A branch that
# has fallen behind can pass every check here and still fail CI against an API
# that changed upstream, so this runs first: it is cheap, and being behind
# invalidates every check that follows.
#
# It reports rather than merges — a hook that mutates the working tree mid-push,
# possibly into a conflict, is worse than the failure it prevents.
base_branch=$(git symbolic-ref --quiet --short refs/remotes/origin/HEAD 2>/dev/null)
base_branch=${base_branch#origin/}
[ -z "$base_branch" ] && base_branch=main
if git rev-parse --verify --quiet "refs/remotes/origin/$base_branch" >/dev/null; then
  git fetch --quiet origin "$base_branch" 2>/dev/null
  commits_behind=$(git rev-list --count "HEAD..origin/$base_branch" 2>/dev/null || echo 0)
  if [ "$commits_behind" -gt 0 ]; then
    echo "Branch is $commits_behind commit(s) behind origin/$base_branch." >&2
    echo "CI builds the merge, not this tree — these checks would validate code that will never exist." >&2
    echo "Run: git merge --no-edit origin/$base_branch   (then push again to re-run the gate)" >&2
    exit 2
  fi
fi

# `build` is not a typecheck: a Next.js build type-checks the app graph, so a
# type error in a test file compiles clean and exits 0. Run the project-wide
# check separately, as CI does. `format:check` is the non-rewriting sibling of a
# `format` script, which is usually `prettier --write` and so can never fail.
if npm run build --if-present \
  && npm run lint --if-present \
  && npm run typecheck --if-present \
  && npm run prettier --if-present \
  && npm run format:check --if-present \
  && npm run test --if-present; then
  exit 0
fi

echo "Pre-push checks failed (build/lint/typecheck/prettier/test). Fix them before pushing." >&2
exit 2

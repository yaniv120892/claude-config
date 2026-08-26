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

# `npm run <name> --if-present` exits 0 for a script the repo does not define,
# so a gate nobody wired up passes by never running — indistinguishable, from
# the exit code alone, from one that ran and was clean. Read the script names
# once and report what was skipped instead of banking a pass nobody earned.
scripts=$(node -e '
  try {
    process.stdout.write(Object.keys(require(process.cwd() + "/package.json").scripts || {}).join(" "));
  } catch { }
' 2>/dev/null)

# typecheck earns its place next to test: vitest and jest transpile without
# checking types, so a signature that no longer holds ships green.
missing=""
for gate in build lint prettier typecheck test; do
  case " $scripts " in
    *" $gate "*) ;;
    *) missing="$missing $gate"; continue ;;
  esac

  # Stop at the first failure rather than running the rest: a broken build
  # makes lint and test output downstream noise.
  if ! npm run "$gate"; then
    echo "Pre-push checks failed at '$gate'. Fix it before pushing." >&2
    exit 2
  fi
done

[ -n "$missing" ] && echo "Pre-push gate: this repo has no npm script for:$missing — those checks did not run." >&2

exit 0

#!/usr/bin/env bash
set -uo pipefail

# The hook-level `if: "Bash(git push:*)"` matcher fails open on compound commands
# (cd, &&, variable assignments, loops, multi-line), so it fires on ordinary
# greps. Re-check the real command text here; without jq, fall back to the whole
# payload so a missing dependency runs the checks rather than silently skipping.
payload=$(cat)
if command -v jq >/dev/null 2>&1; then
  target=$(printf '%s' "$payload" | jq -r '.tool_input.command // empty')
else
  target=$payload
fi

grep -qE 'git[[:space:]]+push' <<<"$target" || exit 0
[ -f package.json ] || exit 0

# Nx monorepos have their own affected-based CI (typecheck/build/lint scoped
# per-project, e2e against migrated Postgres) and this hook's naive
# `npm run test` doesn't know about per-worktree stack-slot DB isolation or
# survive concurrent worktrees' Nx daemons — both false-fail here without the
# change under review being at fault. Defer entirely to CI for these repos.
[ -f nx.json ] && exit 0

if npm run build --if-present \
  && npm run lint --if-present \
  && npm run prettier --if-present \
  && npm run test --if-present; then
  exit 0
fi

echo "Pre-push checks failed (build/lint/prettier/test). Fix them before pushing." >&2
exit 2

#!/usr/bin/env bash
# Exercises require-worktree.sh against a throwaway repository, so the result
# does not depend on which repos happen to be cloned on this machine. Covers the
# main-checkout/linked-worktree split, both symlink shapes, and the escape hatch.
HOOK_NAME=require-worktree.sh
source "$(dirname "${BASH_SOURCE[0]}")/harness.sh"

sandbox=$(mktemp -d)
trap 'rm -rf "$sandbox"' EXIT

main="$sandbox/repo"
git init --quiet "$main"
git -C "$main" -c user.email=t@t -c user.name=t commit --quiet --allow-empty -m init
mkdir -p "$main/src"
touch "$main/src/app.ts"
git -C "$main" worktree add --quiet -b feature "$main/.claude/worktrees/feature" 2>/dev/null
touch "$main/.claude/worktrees/feature/src/app.ts" 2>/dev/null

# Both shapes install.sh creates: a symlinked file and a symlinked directory,
# each pointing from outside the repo into it.
mkdir -p "$sandbox/home"
ln -s "$main/src/app.ts" "$sandbox/home/linked-file.ts"
ln -s "$main/src" "$sandbox/home/linked-dir"

# check <expected> <label> <json payload>
check() {
  local expected="$1" label="$2" actual
  if [ -z "$(printf '%s\0' "$3" | "$HOOK")" ]; then actual=allow; else actual=DENY; fi
  report "$label" "$expected" "$actual"
}

path_payload() { printf '{"tool_input":{"file_path":"%s"}}' "$1"; }

echo "--- must block: the main checkout ---"
check DENY  "tracked file"        "$(path_payload "$main/src/app.ts")"
check DENY  "repo root file"      "$(path_payload "$main/README.md")"
check DENY  "dir not created yet" "$(path_payload "$main/a/b/c/new.ts")"
check DENY  "symlinked file"      "$(path_payload "$sandbox/home/linked-file.ts")"
check DENY  "symlinked directory" "$(path_payload "$sandbox/home/linked-dir/app.ts")"
check DENY  "notebook"            "$(printf '{"tool_input":{"notebook_path":"%s"}}' "$main/x.ipynb")"

echo "--- must allow ---"
check allow "linked worktree"     "$(path_payload "$main/.claude/worktrees/feature/src/app.ts")"
check allow "new file in worktree" "$(path_payload "$main/.claude/worktrees/feature/src/new.ts")"
check allow "outside any repo"    "$(path_payload "$sandbox/home/scratch.md")"
check allow "no path in payload"  '{"tool_input":{"command":"ls"}}'

echo "--- escape hatch ---"
actual=$(CLAUDE_WORKTREE_GUARD=off "$HOOK" < <(printf '%s\0' "$(path_payload "$main/src/app.ts")"))
report "CLAUDE_WORKTREE_GUARD=off" "" "$actual"

summarize

#!/usr/bin/env bash
# Verifies the hook targets the repo being pushed, not the session's directory.
source "$(dirname "${BASH_SOURCE[0]}")/harness.sh"
TMP="$(mktemp -d)"

# repo A: has package.json with a build that FAILS -> hook must exit 2
mkdir -p "$TMP/repoA" && cd "$TMP/repoA" && git init -q .
printf '{"name":"a","scripts":{"build":"exit 1"}}' > package.json
git add -A && git -c user.email=t@t -c user.name=t commit -qm init

# repo B: has package.json with a build that PASSES -> hook must exit 0
mkdir -p "$TMP/repoB" && cd "$TMP/repoB" && git init -q .
printf '{"name":"b","scripts":{"build":"exit 0"}}' > package.json
git add -A && git -c user.email=t@t -c user.name=t commit -qm init

fire() {  # $1 = command text, $2 = payload cwd
  python3 -c 'import json,sys;print(json.dumps({"tool_input":{"command":sys.argv[1]},"cwd":sys.argv[2]}))' "$1" "$2" \
    | bash "$HOOK" >/dev/null 2>&1
  echo $?
}

PUSH='git''''  push'
PUSH="git p""ush"

# Session sits in repoB (good build) but the command pushes from repoA (bad build).
report "cd into failing repo is honoured" 2 "$(fire "cd $TMP/repoA && $PUSH" "$TMP/repoB")"
# Session sits in repoA (bad build) but command pushes repoB via -C.
report "git -C targets the named repo"    0 "$(fire "git -C $TMP/repoB p""ush" "$TMP/repoA")"
# No cd: falls back to payload cwd.
report "payload cwd used when no cd"      2 "$(fire "$PUSH" "$TMP/repoA")"
report "payload cwd passing repo"         0 "$(fire "$PUSH" "$TMP/repoB")"
# Non-push command must not run anything.
report "non-push skipped"                 0 "$(fire "echo hello" "$TMP/repoA")"
# Subdirectory resolves to repo root.
mkdir -p "$TMP/repoA/src/deep"
report "subdir resolves to repo root"     2 "$(fire "cd $TMP/repoA/src/deep && $PUSH" "$TMP/repoB")"
# Outside any git repo -> skip.
report "non-repo cwd skipped"             0 "$(fire "$PUSH" "$TMP")"
# Multiple cd's: the one immediately before the push wins, not the first.
report "last cd before push wins"         0 "$(fire "cd $TMP/repoA && echo hi; cd $TMP/repoB && $PUSH" "$TMP/repoA")"
report "last cd before push wins (fail)"  2 "$(fire "cd $TMP/repoB && echo hi; cd $TMP/repoA && $PUSH" "$TMP/repoB")"
# A cd AFTER the push must not be mistaken for the push's directory.
report "cd after push ignored"            2 "$(fire "cd $TMP/repoA && $PUSH; cd $TMP/repoB" "$TMP/repoB")"

rm -rf "$TMP"
summarize

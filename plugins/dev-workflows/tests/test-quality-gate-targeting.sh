#!/usr/bin/env bash
# Verifies the hook targets the repo being pushed, not the session's directory.
HOOK="$HOME/Develop/claude-config/plugins/dev-workflows/hooks/pre-push-quality-gate.sh"
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

fails=0
check() {
  local label="$1" expected="$2" actual="$3"
  if [ "$actual" = "$expected" ]; then echo "PASS  $label (exit $actual)"; else echo "FAIL  $label expected $expected got $actual"; fails=$((fails+1)); fi
}

# Session sits in repoB (good build) but the command pushes from repoA (bad build).
check "cd into failing repo is honoured" 2 "$(fire "cd $TMP/repoA && $PUSH" "$TMP/repoB")"
# Session sits in repoA (bad build) but command pushes repoB via -C.
check "git -C targets the named repo"    0 "$(fire "git -C $TMP/repoB p""ush" "$TMP/repoA")"
# No cd: falls back to payload cwd.
check "payload cwd used when no cd"      2 "$(fire "$PUSH" "$TMP/repoA")"
check "payload cwd passing repo"         0 "$(fire "$PUSH" "$TMP/repoB")"
# Non-push command must not run anything.
check "non-push skipped"                 0 "$(fire "echo hello" "$TMP/repoA")"
# Subdirectory resolves to repo root.
mkdir -p "$TMP/repoA/src/deep"
check "subdir resolves to repo root"     2 "$(fire "cd $TMP/repoA/src/deep && $PUSH" "$TMP/repoB")"
# Outside any git repo -> skip.
check "non-repo cwd skipped"             0 "$(fire "$PUSH" "$TMP")"

rm -rf "$TMP"
echo
[ "$fails" -eq 0 ] && echo "ALL PASS" || echo "$fails FAILURES"
exit "$fails"

#!/usr/bin/env bash
# Verifies protect-default-branch.sh blocks a real git commit/push while the
# target directory sits on the repo's default branch, and stays out of the way
# everywhere else: feature branches, mentions that aren't invocations, the
# escape hatch, and repos with no default branch to resolve.
HOOK_NAME=protect-default-branch.sh
source "$(dirname "${BASH_SOURCE[0]}")/harness.sh"
TMP="$(mktemp -d)"

git_quiet() { git -c user.email=t@t -c user.name=t "$@"; }

# A bare `-b main` remote plus fetch + `remote set-head -a` gives a deterministic
# refs/remotes/origin/HEAD, the same signal a real GitHub clone carries.
git_quiet init -q --bare -b main "$TMP/origin"
git_quiet clone -q "$TMP/origin" "$TMP/work" 2>/dev/null
cd "$TMP/work"
echo init > file.txt
git_quiet add -A && git_quiet commit -qm init && git_quiet push -q -u origin main
git_quiet fetch -q origin
git_quiet remote set-head origin -a >/dev/null
git_quiet checkout -q -b feature

# Split so this test file's own source doesn't read as the invocation it's
# testing for.
COMMIT="git c""ommit -m x"
PUSH="git p""ush"

fire() {  # $1 = command text, $2 = payload cwd
  python3 -c 'import json,sys;print(json.dumps({"tool_input":{"command":sys.argv[1]},"cwd":sys.argv[2]}))' "$1" "$2" \
    | bash "$HOOK" >/dev/null 2>&1
  echo $?
}

stderr_of() {  # $1 = command text, $2 = payload cwd
  python3 -c 'import json,sys;print(json.dumps({"tool_input":{"command":sys.argv[1]},"cwd":sys.argv[2]}))' "$1" "$2" \
    | bash "$HOOK" 2>&1 >/dev/null
}

fire_with_env() {  # $1 = env assignment (NAME=value), $2 = command text, $3 = payload cwd
  local envpair="$1"
  python3 -c 'import json,sys;print(json.dumps({"tool_input":{"command":sys.argv[1]},"cwd":sys.argv[2]}))' "$2" "$3" \
    | env "$envpair" bash "$HOOK" >/dev/null 2>&1
  echo $?
}

echo "--- must NOT trigger ---"
report "mention in echo is not an invocation" 0 "$(fire 'echo "then git commit"' "$TMP/work")"
report "mention in grep is not an invocation" 0 "$(fire 'grep -r "git push" .' "$TMP/work")"
report "non-write command is skipped"         0 "$(fire "ls -la" "$TMP/work")"

echo "--- must block: writing on the default branch ---"
git_quiet checkout -q main
report "commit on the default branch"  2 "$(fire "$COMMIT" "$TMP/work")"
report "push on the default branch"    2 "$(fire "$PUSH" "$TMP/work")"

case "$(stderr_of "$COMMIT" "$TMP/work")" in
  *"git checkout -b"*) report "block names the remedy" 0 0 ;;
  *) report "block names the remedy" 0 1 ;;
esac

echo "--- must allow: writing on a feature branch ---"
git_quiet checkout -q feature
report "commit on a feature branch" 0 "$(fire "$COMMIT" "$TMP/work")"
report "push on a feature branch"   0 "$(fire "$PUSH" "$TMP/work")"

echo "--- escape hatch ---"
git_quiet checkout -q main
report "ALLOW_DEFAULT_BRANCH_WRITE=1 prefix in the command" 0 \
  "$(fire "ALLOW_DEFAULT_BRANCH_WRITE=1 $COMMIT" "$TMP/work")"
report "ALLOW_DEFAULT_BRANCH_WRITE=1 set directly on the hook's process also allows" 0 \
  "$(fire_with_env "ALLOW_DEFAULT_BRANCH_WRITE=1" "$COMMIT" "$TMP/work")"

echo "--- prefixes that must not bypass detection ---"
report "FOO=bar env-assignment prefix still triggers" 2 "$(fire "FOO=bar $COMMIT" "$TMP/work")"
report "sudo prefix still triggers"                    2 "$(fire "sudo $COMMIT" "$TMP/work")"

echo "--- target resolution ---"
report "git -C targets the checkout, not the payload cwd" 2 \
  "$(fire "git -C $TMP/work c""ommit -m x" "$TMP")"
git_quiet checkout -q feature
report "git -C tracks the checked-out branch, not just the directory name" 0 \
  "$(fire "git -C $TMP/work c""ommit -m x" "$TMP")"
git_quiet checkout -q main

echo "--- nothing to resolve ---"
mkdir -p "$TMP/lonely" && cd "$TMP/lonely" && git_quiet init -q .
echo x > f.txt && git_quiet add -A && git_quiet commit -qm init
report "no origin is not a blocker" 0 "$(fire "$COMMIT" "$TMP/lonely")"

cd "$TMP/work"
git_quiet checkout -q "$(git_quiet rev-parse HEAD)"
report "detached HEAD is not a blocker" 0 "$(fire "$COMMIT" "$TMP/work")"

cd /
rm -rf "$TMP"
summarize

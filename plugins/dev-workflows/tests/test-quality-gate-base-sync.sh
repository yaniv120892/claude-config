#!/usr/bin/env bash
# Verifies the hook refuses a push from a branch that has fallen behind its base,
# and that it stays out of the way when there is no base to compare against.
source "$(dirname "${BASH_SOURCE[0]}")/harness.sh"
TMP="$(mktemp -d)"

git_quiet() { git -c user.email=t@t -c user.name=t "$@"; }

# `-b main` matters: a bare repo left on the default branch name makes its HEAD
# dangle, and every clone of it lands with no checkout at all.
git_quiet init -q --bare -b main "$TMP/origin"

# Scripts all pass, so the only thing that can fail a run is the sync check.
git_quiet clone -q "$TMP/origin" "$TMP/work" 2>/dev/null
cd "$TMP/work"
printf '{"name":"w","scripts":{"build":"exit 0","lint":"exit 0","typecheck":"exit 0","test":"exit 0"}}' > package.json
git_quiet add -A && git_quiet commit -qm init && git_quiet push -q -u origin main

fire() {  # $1 = command text, $2 = payload cwd
  python3 -c 'import json,sys;print(json.dumps({"tool_input":{"command":sys.argv[1]},"cwd":sys.argv[2]}))' "$1" "$2" \
    | bash "$HOOK" >/dev/null 2>&1
  echo $?
}

stderr_of() {  # $1 = command text, $2 = payload cwd
  python3 -c 'import json,sys;print(json.dumps({"tool_input":{"command":sys.argv[1]},"cwd":sys.argv[2]}))' "$1" "$2" \
    | bash "$HOOK" 2>&1 >/dev/null
}

PUSH="git p""ush"

report "up to date passes" 0 "$(fire "$PUSH" "$TMP/work")"

# A second clone lands a commit on main, leaving the first clone behind.
git_quiet clone -q "$TMP/origin" "$TMP/other"
cd "$TMP/other"
echo upstream > upstream.txt
git_quiet add -A && git_quiet commit -qm upstream && git_quiet push -q origin main

cd "$TMP/work"
report "behind the base is refused" 2 "$(fire "$PUSH" "$TMP/work")"

# The message has to name the remedy, or the block is just an obstacle.
case "$(stderr_of "$PUSH" "$TMP/work")" in
  *"git merge --no-edit origin/main"*) report "block names the merge command" 0 0 ;;
  *) report "block names the merge command" 0 1 ;;
esac

# The sync check must run before the expensive steps — a stale branch should not
# pay for a build first. A failing build with the branch behind still reports the
# sync problem, which it can only do by short-circuiting ahead of it.
python3 - "$TMP/work" <<'PY'
import json, sys
path = sys.argv[1] + "/package.json"
data = json.load(open(path))
data["scripts"]["build"] = "exit 1"
json.dump(data, open(path, "w"))
PY
case "$(stderr_of "$PUSH" "$TMP/work")" in
  *"commit(s) behind"*) report "sync check precedes the build" 0 0 ;;
  *) report "sync check precedes the build" 0 1 ;;
esac
git_quiet checkout -q -- package.json

# Merging the base clears the block without any other change.
git_quiet merge -q --no-edit origin/main
report "merging the base unblocks" 0 "$(fire "$PUSH" "$TMP/work")"

# A repo with no origin at all must not be blocked — the check has nothing to
# compare against and should stay silent rather than guess.
mkdir -p "$TMP/lonely" && cd "$TMP/lonely" && git init -q .
printf '{"name":"l","scripts":{"build":"exit 0"}}' > package.json
git_quiet add -A && git_quiet commit -qm init
report "no origin is not a blocker" 0 "$(fire "$PUSH" "$TMP/lonely")"

cd /
rm -rf "$TMP"
summarize

#!/usr/bin/env bash
# Exercises the tightened invocation matcher in pre-push-quality-gate.sh.
# Runs from a directory with no package.json, so a "triggered" case still exits 0
# after the package.json guard — what we assert is the matcher's decision, which
# we observe by stubbing the guard out via a marker file.
source "$(dirname "${BASH_SOURCE[0]}")/harness.sh"

# Extract just the matcher line and evaluate it standalone.
PATTERN=$(grep -oE "^readonly GIT_PUSH_INVOCATION='.*'$" "$HOOK" | sed "s/^readonly GIT_PUSH_INVOCATION='//; s/'$//")

check() {
  local expected="$1" text="$2" actual
  if grep -qE "$PATTERN" <<<"$text"; then actual="TRIGGER"; else actual="skip"; fi
  report "$text" "$expected" "$actual"
}

echo "--- must NOT trigger ---"
check skip    'echo "remember to gi''t pu''sh later"'
check skip    'grep -r "gi''t pu''sh" .'
check skip    'cat <<EOF
"if": "Bash(gi''t pu''sh:*)"
EOF'
check skip    'gi''t pu''shed_branch'
check skip    'git pushx'

echo "--- must trigger ---"
check TRIGGER 'gi''t pu''sh'
check TRIGGER 'gi''t pu''sh -u origin HEAD'
check TRIGGER 'cd /tmp && gi''t pu''sh'
check TRIGGER 'npm test && gi''t pu''sh --tags'
check TRIGGER 'gi''t -C /repo pu''sh'
check TRIGGER 'sudo gi''t pu''sh'
check TRIGGER 'gi''t pu''sh; cd elsewhere'
check TRIGGER 'gi''t pu''sh && echo done'
check TRIGGER '(cd x && gi''t pu''sh)'
check TRIGGER 'gi''t pu''sh|tee log'

summarize

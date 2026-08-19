#!/usr/bin/env bash
# Exercises the tightened invocation matcher in pre-push-quality-gate.sh.
# Runs from a directory with no package.json, so a "triggered" case still exits 0
# after the package.json guard — what we assert is the matcher's decision, which
# we observe by stubbing the guard out via a marker file.
HOOK="$HOME/Develop/claude-config/plugins/dev-workflows/hooks/pre-push-quality-gate.sh"

# Extract just the matcher line and evaluate it standalone.
PATTERN=$(grep -oE "^readonly GIT_PUSH_INVOCATION='.*'$" "$HOOK" | sed "s/^readonly GIT_PUSH_INVOCATION='//; s/'$//")

check() {
  local expected="$1" text="$2"
  if grep -qE "$PATTERN" <<<"$text"; then actual="TRIGGER"; else actual="skip"; fi
  if [ "$actual" = "$expected" ]; then status="PASS"; else status="FAIL"; fi
  printf '%-5s %-8s %s\n' "$status" "$actual" "$text"
  [ "$status" = "PASS" ]
}

fails=0
echo "--- must NOT trigger ---"
check skip    'echo "remember to gi''t pu''sh later"'                || fails=$((fails+1))
check skip    'grep -r "gi''t pu''sh" .'                             || fails=$((fails+1))
check skip    'cat <<EOF
"if": "Bash(gi''t pu''sh:*)"
EOF'                                                                 || fails=$((fails+1))
check skip    'gi''t pu''shed_branch'                                || fails=$((fails+1))
check skip    'git pushx'                                            || fails=$((fails+1))

echo "--- must trigger ---"
check TRIGGER 'gi''t pu''sh'                                         || fails=$((fails+1))
check TRIGGER 'gi''t pu''sh -u origin HEAD'                          || fails=$((fails+1))
check TRIGGER 'cd /tmp && gi''t pu''sh'                              || fails=$((fails+1))
check TRIGGER 'npm test && gi''t pu''sh --tags'                      || fails=$((fails+1))
check TRIGGER 'gi''t -C /repo pu''sh'                                || fails=$((fails+1))
check TRIGGER 'sudo gi''t pu''sh'                                    || fails=$((fails+1))

echo
if [ "$fails" -eq 0 ]; then echo "ALL PASS"; else echo "$fails FAILURES"; fi
exit "$fails"

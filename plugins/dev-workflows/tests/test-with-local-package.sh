#!/usr/bin/env bash
# The override must be visible to the gate command and gone afterwards, byte-for-byte.
# A mutated copy with the restore removed must fail the same check.
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPT="$here/../skills/pre-push-quality-gate/with-local-package.sh"
sandbox=$(mktemp -d)
trap 'rm -rf "$sandbox"' EXIT

mkdir -p "$sandbox/bin" "$sandbox/src"
cat >"$sandbox/bin/pnpm" <<'PNPM'
#!/usr/bin/env bash
case "$*" in
  *"run build"*) exit 0 ;;
  install*) echo "lock mutated" >>pnpm-lock.yaml ;;
esac
PNPM
chmod +x "$sandbox/bin/pnpm"

fails=0
run() {
  local c="$sandbox/consumer"
  rm -rf "$c" "$sandbox/before"; mkdir -p "$c"
  printf '{"name":"x"}\n' >"$c/package.json"
  printf 'lock: 1\n' >"$c/pnpm-lock.yaml"
  [ -n "$2" ] && printf '%s' "$2" >"$c/pnpm-workspace.yaml"
  cp -r "$c" "$sandbox/before"
  PATH="$sandbox/bin:$PATH" "$1" "$c" @bazak/pkg "$sandbox/src" -- \
    grep -q "'@bazak/pkg': link:" pnpm-workspace.yaml || { echo "override-missing"; return; }
  diff -r "$sandbox/before" "$c" >/dev/null && echo restored || echo dirty
}
expect() {
  if [ "$2" = "$3" ]; then echo "PASS  $1 ($3)"; else echo "FAIL  $1 expected $2 got $3"; fails=$((fails+1)); fi
}

expect "no workspace yaml" restored "$(run "$SCRIPT" "")"
expect "existing overrides block" restored "$(run "$SCRIPT" $'packages:\n  - a\noverrides:\n  foo: 1\n')"

sed 's/^trap restore EXIT$//' "$SCRIPT" >"$sandbox/mutant.sh"; chmod +x "$sandbox/mutant.sh"
expect "mutant without restore is caught" dirty "$(run "$sandbox/mutant.sh" "")"

[ "$fails" -eq 0 ] && echo "ALL PASS" || echo "$fails FAILURES"
exit "$fails"

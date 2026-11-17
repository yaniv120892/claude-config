#!/usr/bin/env bash
# Run a command in a pnpm consumer repo with one @bazak/* package overridden to a
# local build, then restore the manifest files byte-for-byte.
# Usage: with-local-package.sh <consumer-dir> <@scope/pkg> <package-src-dir> -- <cmd...>
set -u
[ $# -ge 5 ] && [ "$4" = "--" ] || { echo "usage: $0 <consumer> <pkg> <src-dir> -- <cmd...>" >&2; exit 2; }
consumer=$(cd "$1" && pwd) pkg=$2 src=$(cd "$3" && pwd)
shift 4
files=(package.json pnpm-workspace.yaml pnpm-lock.yaml)

snap=$(mktemp -d)
restore() {
  for f in "${files[@]}"; do
    if [ -e "$snap/$f" ]; then cp -p "$snap/$f" "$consumer/$f"; else rm -f "$consumer/$f"; fi
  done
  rm -rf "$snap"
}
for f in "${files[@]}"; do [ -e "$consumer/$f" ] && cp -p "$consumer/$f" "$snap/$f"; done
trap restore EXIT

pnpm -C "$src" run build || exit 1

# pnpm reads overrides from pnpm-workspace.yaml when present, so write them there.
# Limitation: an existing `overrides:` block must be top-level with 2-space entries.
entry="  '$pkg': link:$src"
if [ -e "$consumer/pnpm-workspace.yaml" ]; then
  if grep -q '^overrides:' "$consumer/pnpm-workspace.yaml"; then
    awk -v e="$entry" '{print} /^overrides:/{print e}' "$consumer/pnpm-workspace.yaml" >"$snap/ws.new"
    cp "$snap/ws.new" "$consumer/pnpm-workspace.yaml"
  else
    printf 'overrides:\n%s\n' "$entry" >>"$consumer/pnpm-workspace.yaml"
  fi
else
  printf 'overrides:\n%s\n' "$entry" >"$consumer/pnpm-workspace.yaml"
fi

cd "$consumer" || exit 1
pnpm install --no-frozen-lockfile || exit 1
"$@"

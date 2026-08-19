#!/usr/bin/env bash
#
# reinstall.sh — regenerate a repo's lockfile for a freshly bumped shared package and
# verify it resolves from the registry, not a stale local file:/link: reference.
#
# Faithfully extracted from the dependency-bump skill prose. It detects the package
# manager from the lockfile, removes node_modules + the lockfile (NOT `npm ci`, which
# preserves stale entries), reinstalls, then fails loudly if the package still resolves
# to a local path. SMOKE-TEST ON FIRST USE.
#
# Usage:
#   reinstall.sh <repo-path> <package-name>
#   reinstall.sh ~/Develop/ma-toolkit/ai-workflow-engine @models/media-generation-model

set -euo pipefail

main() {
  local repo_path="${1:-}"
  local package_name="${2:-}"
  require_args "$repo_path" "$package_name"

  cd "$repo_path"
  local package_manager
  package_manager="$(detect_package_manager)"

  clean_install "$package_manager"
  verify_lockfile "$package_manager" "$package_name"
}

require_args() {
  local repo_path="$1"
  local package_name="$2"
  if [[ -z "$repo_path" || -z "$package_name" ]]; then
    printf 'Usage: %s <repo-path> <package-name>\n' "$(basename "$0")" >&2
    exit 1
  fi
  if [[ ! -d "$repo_path" ]]; then
    printf 'error: repo path does not exist: %s\n' "$repo_path" >&2
    exit 1
  fi
}

detect_package_manager() {
  if [[ -f pnpm-lock.yaml ]]; then
    printf 'pnpm'
  else
    printf 'npm'
  fi
}

clean_install() {
  local package_manager="$1"
  rm -rf node_modules
  case "$package_manager" in
    pnpm)
      pnpm install
      ;;
    npm)
      rm -f package-lock.json
      npm install
      ;;
  esac
}

verify_lockfile() {
  local package_manager="$1"
  local package_name="$2"
  local lockfile offenders
  case "$package_manager" in
    pnpm)
      lockfile="pnpm-lock.yaml"
      ;;
    npm)
      lockfile="package-lock.json"
      ;;
  esac

  offenders="$(grep -nE "(file:|link.*true)" "$lockfile" 2>/dev/null | grep -F "$package_name" || true)"
  if [[ -n "$offenders" ]]; then
    printf 'LOCKFILE VERIFICATION FAILED — %s still resolves to a local reference in %s:\n' \
      "$package_name" "$lockfile" >&2
    printf '%s\n' "$offenders" >&2
    printf 'Fix: rm -rf node_modules, delete the lockfile, clear the cache, reinstall, re-run.\n' >&2
    exit 1
  fi
  printf 'OK — %s resolves from the registry in %s.\n' "$package_name" "$lockfile"
}

main "$@"

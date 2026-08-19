#!/usr/bin/env bash
#
# install.sh — link this repo's Claude Code config into a profile directory.
#
# Everything is symlinked, so editing a file here takes effect immediately and
# `git status` in this repo is the single source of truth for what you've changed.
# The one exception is settings.json, which is copied and never overwritten,
# because it accumulates machine-local state you don't want clobbered.
#
# Usage:
#   ./install.sh                      # personal profile → ~/.claude
#   ./install.sh --profile work       # work profile     → ~/.claude
#   ./install.sh --target ~/.claude-personal
#   ./install.sh --dry-run
#
# This installs only the parts a plugin cannot carry: the always-loaded global
# rules, the path-scoped rules/, settings, keybindings, and the statusline.
# Skills, commands, and hooks ship as PLUGINS from this same repo — see README.
#
# Anything already present is backed up to ~/.claude-config-backups/<timestamp>/
# before being replaced. Existing skills are left completely alone.

set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROFILE="personal"
TARGET="$HOME/.claude"
DRY_RUN=0

while [ $# -gt 0 ]; do
  case "$1" in
    --profile) PROFILE="${2:?--profile needs a value}"; shift 2 ;;
    --target)  TARGET="${2:?--target needs a value}"; shift 2 ;;
    --dry-run) DRY_RUN=1; shift ;;
    -h|--help) sed -n '2,22p' "$0"; exit 0 ;;
    *) echo "unknown argument: $1" >&2; exit 1 ;;
  esac
done

if [ ! -d "$REPO_DIR/profiles/$PROFILE" ]; then
  echo "error: no such profile '$PROFILE' (expected $REPO_DIR/profiles/$PROFILE)" >&2
  exit 1
fi

TARGET="${TARGET/#\~/$HOME}"
BACKUP_DIR="$HOME/.claude-config-backups/$(date +%Y%m%d-%H%M%S)"

say() { printf '%s\n' "$*"; }
run() {
  if [ "$DRY_RUN" -eq 1 ]; then
    say "  would: $*"
  else
    "$@"
  fi
}

# Move an existing path aside before we replace it. A symlink that already
# points into this repo is left alone — re-running the installer is a no-op.
backup_if_present() {
  local path="$1"
  [ -e "$path" ] || [ -L "$path" ] || return 0
  if [ -L "$path" ] && [[ "$(readlink "$path")" == "$REPO_DIR"* ]]; then
    return 0
  fi
  local relative="${path#$HOME/}"
  local destination="$BACKUP_DIR/${relative//\//__}"
  run mkdir -p "$BACKUP_DIR"
  say "  backup: $path -> $destination"
  run mv "$path" "$destination"
}

link() {
  local source="$1" destination="$2"
  backup_if_present "$destination"
  if [ -L "$destination" ] && [[ "$(readlink "$destination")" == "$REPO_DIR"* ]]; then
    say "  ok:     $destination (already linked)"
    return 0
  fi
  run mkdir -p "$(dirname "$destination")"
  run ln -s "$source" "$destination"
  say "  link:   $destination -> $source"
}

say "Installing profile '$PROFILE' into $TARGET"
[ "$DRY_RUN" -eq 1 ] && say "(dry run — nothing will change)"
run mkdir -p "$TARGET"

# Shared rules are imported by absolute path (@~/.claude/shared-rules.md), so
# they must exist under ~/.claude even when the active profile lives elsewhere.
SHARED_HOME="$HOME/.claude"
run mkdir -p "$SHARED_HOME"
link "$REPO_DIR/shared-rules.md"    "$SHARED_HOME/shared-rules.md"
link "$REPO_DIR/rules"              "$SHARED_HOME/rules"
link "$REPO_DIR/rules-reference.md" "$SHARED_HOME/rules-reference.md"
link "$REPO_DIR/statusline-command.sh" "$SHARED_HOME/statusline-command.sh"

# Profile-scoped pieces. Skills, commands, and hooks are intentionally absent —
# they are installed as plugins, which keeps existing skills untouched.
link "$REPO_DIR/keybindings.json"             "$TARGET/keybindings.json"
link "$REPO_DIR/profiles/$PROFILE/CLAUDE.md"  "$TARGET/CLAUDE.md"

# settings.json is copied, not linked: Claude Code writes machine-local state
# into it, which must not flow back into the repo.
if [ -e "$TARGET/settings.json" ]; then
  say "  keep:   $TARGET/settings.json (exists — compare against settings/settings.json yourself)"
else
  run cp "$REPO_DIR/settings/settings.json" "$TARGET/settings.json"
  say "  copy:   $TARGET/settings.json"
fi

if [ ! -e "$TARGET/.mcp.json" ]; then
  say "  note:   no $TARGET/.mcp.json — see $REPO_DIR/mcp/mcp.json.example"
fi

say ""
say "Done. Verify with:  ls -la $TARGET"
say ""
say "Now install the plugins (skills, commands, hooks):"
say "  /plugin marketplace add $REPO_DIR"
say "  /plugin install pr-workflows@yaniv-claude-config"
say "  /plugin install dev-workflows@yaniv-claude-config"
say "  /plugin install cmux@yaniv-claude-config"
say ""
say "Secrets are NOT in this repo — export them from your shell profile."
[ -d "$BACKUP_DIR" ] && say "Replaced files were moved to $BACKUP_DIR"
exit 0

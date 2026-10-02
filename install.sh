#!/usr/bin/env bash
#
# install.sh — link this repo's agent config into Claude Code, Codex, or both.
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
#   ./install.sh --harness codex      # skills → ~/.agents/skills, AGENTS.md → ~/.codex
#   ./install.sh --harness all
#
# For Claude Code this installs only the parts a plugin cannot carry: the
# always-loaded global rules, the path-scoped rules/, settings, keybindings, and
# the statusline. Skills, commands, and hooks ship as PLUGINS. For Codex it links
# the skills and generates AGENTS.md. README covers both.
#
# Anything already present is backed up to ~/.claude-config-backups/<timestamp>/
# before being replaced. Existing skills are left completely alone.

set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROFILE="personal"
TARGET="$HOME/.claude"
DRY_RUN=0
HARNESS="claude"

while [ $# -gt 0 ]; do
  case "$1" in
    --profile) PROFILE="${2:?--profile needs a value}"; shift 2 ;;
    --target)  TARGET="${2:?--target needs a value}"; shift 2 ;;
    --dry-run) DRY_RUN=1; shift ;;
    --harness) HARNESS="${2:?--harness needs a value}"; shift 2 ;;
    -h|--help) sed -n '2,/^$/{/^#/p;}' "$0"; exit 0 ;;
    *) echo "unknown argument: $1" >&2; exit 1 ;;
  esac
done

case "$HARNESS" in
  claude|codex|all) ;;
  *) echo "error: --harness must be claude, codex or all, not '$HARNESS'" >&2; exit 1 ;;
esac

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

install_claude() {
  say ""
  say "Claude Code → $TARGET"
  run mkdir -p "$TARGET"

  # Profile-scoped pieces. Skills, commands, and plugin hooks are intentionally
  # absent — they install as plugins, which keeps existing skills untouched.
  link "$REPO_DIR/keybindings.json"             "$TARGET/keybindings.json"
  link "$REPO_DIR/profiles/$PROFILE/CLAUDE.md"  "$TARGET/CLAUDE.md"

  # The exception: settings.json declares this PreToolUse hook itself, so no
  # plugin owns it and nothing else would put it on disk. It is referenced as
  # $HOME/.claude/hooks/, hence SHARED_HOME rather than TARGET.
  link "$REPO_DIR/settings/hooks/require-git-approval.sh" \
       "$SHARED_HOME/hooks/require-git-approval.sh"

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
  say "  /plugin install issue-tracker@yaniv-claude-config"
  say "  /plugin install infra-workflows@yaniv-claude-config"
  say "  /plugin install cmux@yaniv-claude-config"
  say ""
}

# Codex reads skills from ~/.agents/skills/ and always-on instructions from
# $CODEX_HOME/AGENTS.md, which follows no @ imports and scopes no rules by path.
# So skills are linked one by one, and AGENTS.md is generated rather than linked.
install_codex() {
  local codex_home="${CODEX_HOME:-$HOME/.codex}" skills_home="$HOME/.agents/skills"
  local agents_md="$codex_home/AGENTS.md"
  say ""
  say "Codex → $skills_home and $agents_md"
  run mkdir -p "$skills_home" "$codex_home"
  local skill_dir
  for skill_dir in "$REPO_DIR"/plugins/*/skills/*/; do
    link "${skill_dir%/}" "$skills_home/$(basename "$skill_dir")"
  done

  # Regenerated on every run, since its sources change. A hand-written AGENTS.md
  # (no generator marker) is moved aside first, like any other replaced file.
  if [ -e "$agents_md" ] && ! grep -q 'generated by claude-config/scripts/agents_md.py' "$agents_md"; then
    backup_if_present "$agents_md"
  fi
  if [ "$DRY_RUN" -eq 1 ]; then
    say "  would: write $agents_md from profiles/$PROFILE/CLAUDE.md"
  else
    python3 "$REPO_DIR/scripts/agents_md.py" --profile "$PROFILE" > "$agents_md"
    say "  write:  $agents_md"
  fi
}

say "Installing profile '$PROFILE' for $HARNESS"
[ "$DRY_RUN" -eq 1 ] && say "(dry run — nothing will change)"

# Shared rules are imported by absolute path (@~/.claude/shared-rules.md), so
# they must exist under ~/.claude even when the active profile lives elsewhere.
SHARED_HOME="$HOME/.claude"
run mkdir -p "$SHARED_HOME"
link "$REPO_DIR/shared-rules.md"    "$SHARED_HOME/shared-rules.md"
link "$REPO_DIR/rules"              "$SHARED_HOME/rules"
link "$REPO_DIR/rules-reference.md" "$SHARED_HOME/rules-reference.md"
link "$REPO_DIR/statusline-command.sh" "$SHARED_HOME/statusline-command.sh"


case "$HARNESS" in
  claude) install_claude ;;
  codex)  install_codex ;;
  all)    install_claude; install_codex ;;
esac

say "Secrets are NOT in this repo — export them from your shell profile."
[ -d "$BACKUP_DIR" ] && say "Replaced files were moved to $BACKUP_DIR"
exit 0

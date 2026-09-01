#!/usr/bin/env bash
#
# setup-dock.sh — rebuild the macOS Dock deterministically, in order.
#
# The Dock is one of the few things Migration Assistant carries but a clean
# rebuild does not, so it gets re-arranged by hand on every new machine. This
# makes it a one-liner instead.
#
# Usage:
#   ./setup-dock.sh              # personal profile
#   ./setup-dock.sh --work       # work profile
#   ./setup-dock.sh --dry-run    # print what would be pinned, change nothing
#
# Apps that are not installed are skipped with a notice rather than failing,
# so this is safe to run before the full software install has finished.

set -euo pipefail

PROFILE="personal"
DRY_RUN=0

while [ $# -gt 0 ]; do
  case "$1" in
    --work)     PROFILE="work"; shift ;;
    --personal) PROFILE="personal"; shift ;;
    --dry-run)  DRY_RUN=1; shift ;;
    -h|--help)  sed -n '2,16p' "$0"; exit 0 ;;
    *) echo "unknown argument: $1" >&2; exit 1 ;;
  esac
done

# Docker's real bundle is nested; pinning the outer wrapper gives a dead tile.
DOCKER="/Applications/Docker.app/Contents/MacOS/Docker Desktop.app"

if [ "$PROFILE" = "work" ]; then
  APPS=(
    "/Applications/Google Chrome.app"
    "$DOCKER"
    "/Applications/Claude.app"
    "/Applications/cmux.app"
    "/Applications/Cursor.app"
    "/System/Applications/Utilities/Terminal.app"
    "/Applications/Slack.app"
    "/Applications/WhatsApp.app"
  )
else
  APPS=(
    "/System/Applications/Notes.app"
    "/Applications/Google Chrome.app"
    "$DOCKER"
    "/Applications/Claude.app"
    "/Applications/cmux.app"
    "/Applications/Cursor.app"
    "/System/Applications/Utilities/Terminal.app"
    "/Applications/WhatsApp.app"
  )
fi

add_tile() {
  local app="$1"
  if [ ! -e "$app" ]; then
    echo "  skip (not installed): $(basename "$app")"
    return 0
  fi
  if [ "$DRY_RUN" -eq 1 ]; then
    echo "  would pin: $(basename "$app")"
    return 0
  fi
  defaults write com.apple.dock persistent-apps -array-add \
    "<dict><key>tile-data</key><dict><key>file-data</key><dict>
     <key>_CFURLString</key><string>file://${app}</string>
     <key>_CFURLStringType</key><integer>15</integer>
     </dict></dict></dict>"
  echo "  pinned: $(basename "$app")"
}

echo "Rebuilding Dock — ${PROFILE} profile"
[ "$DRY_RUN" -eq 1 ] && echo "(dry run — nothing will change)"

[ "$DRY_RUN" -eq 0 ] && defaults write com.apple.dock persistent-apps -array
for app in "${APPS[@]}"; do add_tile "$app"; done

if [ "$DRY_RUN" -eq 0 ]; then
  defaults write com.apple.dock show-recents -bool false
  killall Dock
  echo "Done."
fi

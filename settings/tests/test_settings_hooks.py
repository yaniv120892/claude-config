#!/usr/bin/env python3
"""Check settings.json declares each key once and keeps every hook and plugin it should.

Two branches that each add a `hooks` block land as two `"hooks"` keys in one
object. Git merges that without a conflict — the blocks sit in different places
in the file — and every JSON parser accepts it, silently keeping only the last.
The hook in the earlier block just stops running, with nothing to notice it.
That is how the git-approval gate was dropped once already. The gate now lives
in the `mods` plugin, so the same goes for the plugins that must stay enabled.

Run: python3 settings/tests/test_settings_hooks.py
"""

import json
import os
import sys

SETTINGS = os.path.join(
    os.path.dirname(os.path.abspath(__file__)), "..", "settings.json"
)

# Hook events that must survive any merge. Add to this when a new one ships.
REQUIRED_HOOK_EVENTS = ("SessionStart",)
# Plugins whose guards are not optional: `mods` carries the git write gate.
REQUIRED_PLUGINS = ("mods@yaniv-claude-config",)


def reject_duplicate_keys(pairs: list[tuple[str, object]]) -> dict:
    """Build the object, refusing any key that appears twice.

    Args:
        pairs: Key/value pairs as the decoder found them, in order.

    Returns:
        The decoded object.

    Raises:
        AssertionError: If any key is repeated.
    """
    seen: dict[str, object] = {}
    for key, value in pairs:
        assert key not in seen, (
            f"duplicate key {key!r} — JSON keeps only the last, so whatever the "
            f"earlier one declared is silently inert"
        )
        seen[key] = value
    return seen


def main() -> int:
    """Parse settings.json strictly and assert the required hooks and plugins are present."""
    with open(SETTINGS) as settings_file:
        settings = json.load(settings_file, object_pairs_hook=reject_duplicate_keys)

    hooks = settings.get("hooks", {})
    for event in REQUIRED_HOOK_EVENTS:
        assert event in hooks, f"settings.json lost its {event} hook"
        assert hooks[event], f"{event} is present but empty"

    enabled = settings.get("enabledPlugins", {})
    for plugin in REQUIRED_PLUGINS:
        assert enabled.get(plugin) is True, f"settings.json does not enable {plugin}"

    print(f"ok — settings.json has no duplicate keys and keeps {len(hooks)} hook events")
    return 0


if __name__ == "__main__":
    sys.exit(main())

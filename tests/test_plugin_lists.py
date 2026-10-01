#!/usr/bin/env python3
"""Check every place that lists the plugins agrees with the marketplace manifest.

`install.sh` and the README each type out one `/plugin install` line per plugin.
Nothing ties those lines to `.claude-plugin/marketplace.json`, so a new plugin
lands in the manifest and silently goes missing from the install instructions.
That already happened to `issue-tracker` and `infra-workflows`.

Run: python3 tests/test_plugin_lists.py
"""

import json
import os
import re
import sys

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
INSTALL_LINE = re.compile(r"/plugin install ([\w-]+)@([\w-]+)")


def read(relative_path: str) -> str:
    """Return the text of a file under the repo root.

    Args:
        relative_path: Path relative to the repo root.

    Returns:
        The file's contents.
    """
    with open(os.path.join(ROOT, relative_path), encoding="utf-8") as handle:
        return handle.read()


def installed_plugins(relative_path: str, marketplace: str) -> set[str]:
    """Collect the plugins a file tells the reader to install from this marketplace.

    Args:
        relative_path: The file to scan, relative to the repo root.
        marketplace: The marketplace name each install line must target.

    Returns:
        The plugin names on lines that target `marketplace`.
    """
    return {
        plugin
        for plugin, target in INSTALL_LINE.findall(read(relative_path))
        if target == marketplace
    }


def main() -> int:
    manifest = json.loads(read(".claude-plugin/marketplace.json"))
    expected = {plugin["name"] for plugin in manifest["plugins"]}
    plugins_dir = os.path.join(ROOT, "plugins")
    on_disk = {
        entry.name
        for entry in os.scandir(plugins_dir)
        if entry.is_dir() and not entry.name.startswith(".")
    }

    sources = {"plugins/": on_disk}
    for relative_path in ("install.sh", "README.md"):
        sources[relative_path] = installed_plugins(relative_path, manifest["name"])

    failures = 0
    for source, found in sources.items():
        if found == expected:
            print(f"PASS  {source} lists every plugin")
            continue
        failures += 1
        print(
            f"FAIL  {source}: missing {sorted(expected - found)}, "
            f"not in marketplace.json {sorted(found - expected)}"
        )
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())

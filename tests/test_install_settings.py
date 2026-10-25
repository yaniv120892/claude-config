#!/usr/bin/env python3
"""Check `install.sh` merges new top-level settings into a kept settings.json.

settings.json is copied rather than linked, so a machine that installed before the
repo added a key never received it. The installer now adds each missing top-level
key and leaves every key the machine already has alone.

Run: python3 tests/test_install_settings.py
"""

import json
import os
import subprocess
import sys
import tempfile
from typing import Any

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")


def shipped_settings() -> dict[str, Any]:
    """Return the repo's settings template.

    Returns:
        The parsed settings/settings.json.
    """
    with open(os.path.join(ROOT, "settings", "settings.json"), encoding="utf-8") as handle:
        return json.load(handle)


def install_over(kept: dict[str, Any], *extra_arguments: str) -> tuple[dict[str, Any], str, str]:
    """Run install.sh against a target that already holds a settings.json.

    Args:
        kept: The settings.json the target holds before the install.
        extra_arguments: More install.sh flags, such as --dry-run.

    Returns:
        The target's settings.json afterwards, the installer's output, and the home directory used.
    """
    home = tempfile.mkdtemp()
    target = os.path.join(home, ".claude")
    os.makedirs(target)
    settings_path = os.path.join(target, "settings.json")
    with open(settings_path, "w", encoding="utf-8") as handle:
        json.dump(kept, handle)
    completed = subprocess.run(
        ["bash", os.path.join(ROOT, "install.sh"), "--target", target, *extra_arguments],
        env={**os.environ, "HOME": home},
        capture_output=True,
        text=True,
        check=True,
    )
    with open(settings_path, encoding="utf-8") as handle:
        return json.load(handle), completed.stdout, home


def check_adds_missing_keys_and_keeps_existing_ones() -> list[str]:
    """Missing keys arrive with the shipped value; an existing key keeps the machine's value."""
    shipped = shipped_settings()
    kept = {"permissions": {"allow": ["machine-local"]}, "machineOnly": 1}
    merged, _, home = install_over(kept)
    failures = []
    for key, value in shipped.items():
        expected = kept.get(key, value)
        if merged.get(key) != expected:
            failures.append(f"{key}: expected {expected!r}, got {merged.get(key)!r}")
    if merged.get("machineOnly") != 1:
        failures.append(f"machineOnly was dropped or changed: {merged.get('machineOnly')!r}")
    backups = [name for _, _, files in os.walk(os.path.join(home, ".claude-config-backups")) for name in files]
    if "settings.json" not in backups:
        failures.append(f"no settings.json backup written before the merge (found: {backups})")
    return failures


def check_dry_run_writes_nothing() -> list[str]:
    """--dry-run reports the keys it would add and leaves the file as it was."""
    kept = {"machineOnly": 1}
    merged, output, _ = install_over(kept, "--dry-run")
    failures = []
    if merged != kept:
        failures.append(f"--dry-run changed settings.json to {merged!r}")
    first_missing_key = next(iter(shipped_settings()))
    if f"would: add {first_missing_key}" not in output:
        failures.append(f"--dry-run did not report the missing key:\n{output}")
    return failures


def main() -> int:
    """Run every check and report failures.

    Returns:
        0 when every check passes, 1 otherwise.
    """
    failures = check_adds_missing_keys_and_keeps_existing_ones() + check_dry_run_writes_nothing()
    for failure in failures:
        print(f"FAIL: {failure}")
    if not failures:
        print("ok: install.sh merges missing top-level settings")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())

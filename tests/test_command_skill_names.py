#!/usr/bin/env python3
"""Check no plugin ships a command and a skill under the same name.

When both exist, `/<plugin>:<name>` expands the command, and a Skill call for
the same name then answers that it is already loaded. The skill's instructions
never reach the agent, and nothing errors. That is how `/pr-review` ran for a
while without its own rubric.

Run: python3 tests/test_command_skill_names.py
"""

import glob
import os
import sys

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")


def main() -> int:
    failures = 0
    for plugin_dir in sorted(glob.glob(os.path.join(ROOT, "plugins", "*"))):
        commands = {
            os.path.splitext(os.path.basename(path))[0]
            for path in glob.glob(os.path.join(plugin_dir, "commands", "*.md"))
        }
        skills = {
            os.path.basename(os.path.dirname(path))
            for path in glob.glob(os.path.join(plugin_dir, "skills", "*", "SKILL.md"))
        }
        for name in sorted(commands & skills):
            failures += 1
            print(f"FAIL  {os.path.basename(plugin_dir)}: command and skill both named {name}")
    if not failures:
        print("PASS  no command shares a name with a skill")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())

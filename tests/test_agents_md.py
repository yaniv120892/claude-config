#!/usr/bin/env python3
"""Check the generated AGENTS.md carries everything Codex cannot load by itself.

Codex follows no `@` imports and scopes no rules by path. An import left as a
bare `@path` line, or a rule file missing from the index, is an instruction that
silently never reaches a Codex session.

Run: python3 tests/test_agents_md.py
"""

import glob
import os
import sys

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
sys.path.insert(0, os.path.join(ROOT, "scripts"))

import agents_md  # noqa: E402


def main() -> int:
    failures = []
    shared_rules_heading = "## Memory Management Protocol"
    for profile in sorted(os.listdir(os.path.join(ROOT, "profiles"))):
        built = agents_md.build(profile)
        if any(agents_md.IMPORT_LINE.match(line) for line in built.splitlines()):
            failures.append(f"{profile}: an @ import was left unresolved")
        if shared_rules_heading not in built:
            failures.append(f"{profile}: shared-rules.md was not inlined")
        for rule in glob.glob(os.path.join(ROOT, "rules", "*.md")):
            if f"~/.claude/rules/{os.path.basename(rule)}" not in built:
                failures.append(f"{profile}: rules/{os.path.basename(rule)} is missing from the index")
        if agents_md.HARNESS_NOTES.strip() not in built:
            failures.append(f"{profile}: the harness notes are missing")
        if not built.startswith(agents_md.MARKER):
            failures.append(f"{profile}: the generator marker install.sh looks for is not first")
    for failure in failures:
        print(f"FAIL  {failure}")
    if not failures:
        print("PASS  every profile's AGENTS.md inlines its imports, indexes every rule, and ends with the harness notes")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())

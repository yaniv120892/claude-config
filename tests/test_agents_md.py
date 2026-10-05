#!/usr/bin/env python3
"""Check the generated AGENTS.md carries everything Codex cannot load by itself.

Codex follows no `@` imports. An import left as a bare `@path` line is an
instruction that silently never reaches a Codex session.

Run: python3 tests/test_agents_md.py
"""

import os
import re
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
        if "# Reply Style" not in built:
            failures.append(f"{profile}: the reply-style hook text was not inlined")
    if "worktree" in agents_md.HARNESS_NOTES or "default branch" in agents_md.HARNESS_NOTES:
        failures.append("HARNESS_NOTES carries a hook rule; eval sandboxes on main would obey it")
    # install.sh tells a generated AGENTS.md from a hand-written one by this text;
    # if the two drift, every install backs up the file it generated last time.
    with open(os.path.join(ROOT, "install.sh"), encoding="utf-8") as handle:
        grepped = re.search(r"grep -q '([^']+)' \"\$agents_md\"", handle.read())
    if not grepped or grepped.group(1) not in agents_md.MARKER:
        failures.append("install.sh no longer greps for the marker agents_md.py writes")
    for failure in failures:
        print(f"FAIL  {failure}")
    if not failures:
        print("PASS  every profile's AGENTS.md inlines its imports, and install.sh recognises the file")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())

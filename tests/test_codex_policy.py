#!/usr/bin/env python3
"""Check every explicit-only skill is explicit-only on Codex too.

Claude Code reads `disable-model-invocation: true` from SKILL.md. Codex ignores
that key and reads `policy.allow_implicit_invocation: false` from the skill's
`agents/openai.yaml` instead. A skill marked one way but not the other fires on
its own in one harness, as /ship or a ticket-filing skill would on Codex.

Run: python3 tests/test_codex_policy.py
"""

import glob
import os
import re
import sys

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")


def read(path: str) -> str:
    if not os.path.exists(path):
        return ""
    with open(path, encoding="utf-8") as handle:
        return handle.read()


def main() -> int:
    failures = 0
    skills = sorted(glob.glob(os.path.join(ROOT, "plugins", "*", "skills", "*", "SKILL.md")))
    for skill_md in skills:
        skill_dir = os.path.dirname(skill_md)
        claude_explicit = bool(re.search(r"^disable-model-invocation:\s*true\s*$", read(skill_md), re.MULTILINE))
        policy = read(os.path.join(skill_dir, "agents", "openai.yaml"))
        codex_explicit = bool(re.search(r"^\s+allow_implicit_invocation:\s*false\s*$", policy, re.MULTILINE))
        if claude_explicit != codex_explicit:
            failures += 1
            claude = "explicit-only" if claude_explicit else "auto-invocable"
            codex = "explicit-only" if codex_explicit else "auto-invocable"
            print(f"FAIL  {os.path.relpath(skill_dir, ROOT)}: {claude} on Claude Code, {codex} on Codex")
    if not failures:
        print(f"PASS  {len(skills)} skills invoke the same way on both harnesses")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())

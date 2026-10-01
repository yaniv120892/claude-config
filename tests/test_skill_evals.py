#!/usr/bin/env python3
"""Check every skill's evals.json is well-formed, without running any agent.

The evals themselves cost model calls, so CI never runs them. A malformed case
would then sit unnoticed until someone paid for a run that crashes on it; this
catches it on the pull request that introduced it.

Run: python3 tests/test_skill_evals.py
"""

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "evals"))

import run  # noqa: E402


def main() -> int:
    skills = run.discover(None)
    errors = run.validate_all(skills) or ([] if skills else ["no skill ships an evals/evals.json"])
    for error in errors:
        print(f"FAIL  {error}")
    if not errors:
        print(f"PASS  {len(skills)} skills, {sum(len(skill.cases) for skill in skills)} cases")
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())

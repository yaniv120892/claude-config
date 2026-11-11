#!/usr/bin/env python3
"""Check the mods band and the cockpit pane define the context gauge the same way.

Plugins share no code, so each keeps its own copy of `contextGauge`, its input
type and `kiloTokens`. An edit to one copy alone brings back two context counts
that disagree, while each plugin's own tests still pass.

Run: python3 tests/test_context_gauge_twins.py
"""

import os
import re
import sys

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
TWINS = [os.path.join(ROOT, "plugins", plugin, "hooks", "usage.ts") for plugin in ("mods", "cockpit")]
DECLARATIONS = [
    r"/\*\* The fields of the session's context usage.*?\n}\n",
    r"/\*\*\n \* The context as a share of the auto-compact threshold.*?\n}\n",
    r"export function kiloTokens.*?\n}\n",
]


def main() -> int:
    sources = [open(path, encoding="utf-8").read() for path in TWINS]
    failures = []
    for pattern in DECLARATIONS:
        found = [re.search(pattern, source, re.DOTALL) for source in sources]
        if not all(found):
            failures.append(f"{pattern!r} is missing from {[path for path, match in zip(TWINS, found) if not match]}")
        elif found[0].group(0) != found[1].group(0):
            failures.append(f"{pattern!r} differs between {TWINS[0]} and {TWINS[1]}")
    for failure in failures:
        print(f"FAIL: {failure}")
    if not failures:
        print(f"ok: {len(DECLARATIONS)} declarations match between mods and cockpit")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())

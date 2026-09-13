#!/usr/bin/env python3
"""Check that a None GraphQL variable is omitted rather than stringified.

`-F cursor=None` puts the literal string "None" on the wire as the `after`
cursor. GitHub does not reject it — it answers with a short first page and
`hasNextPage: false`, so the pagination loop stops and the caller reports a
subset of the review threads as if it were all of them. Observed on a real PR:
10 of 17 threads, no error anywhere.

Run: python3 plugins/pr-workflows/tests/test_graphql_null_variables.py
"""

import json
import os
import subprocess
import sys
from types import SimpleNamespace

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "lib"))

import github  # noqa: E402


def main() -> int:
    """Run the check against a stubbed `gh` invocation."""
    captured: list[list[str]] = []

    def fake_run(command, capture_output, text, check):
        captured.append(command)
        return SimpleNamespace(stdout=json.dumps({"data": {}}), stderr="")

    github.subprocess.run = fake_run

    github._graphql("query{x}", {"number": 387, "cursor": None})
    command = captured[0]

    assert "cursor=None" not in command, command
    assert not any(argument.startswith("cursor=") for argument in command), command
    # The variables that do have values still go through.
    assert "number=387" in command, command

    captured.clear()
    github._graphql("query{x}", {"cursor": "Y3Vyc29yOnYyOpHOAA"})
    assert "cursor=Y3Vyc29yOnYyOpHOAA" in captured[0], captured[0]

    print("ok — a None variable is omitted, a real cursor is still sent")
    return 0


if __name__ == "__main__":
    sys.exit(main())

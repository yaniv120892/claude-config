#!/usr/bin/env python3
"""Check that resolve_thread uses a supplied node id instead of looking it up.

The lookup pages through every review thread on the pull request to map one
REST comment id. Dropping the argument at a call site still resolves the thread,
so nothing fails — it just pays that walk again per thread resolved.

Run: python3 plugins/pr-workflows/tests/test_resolve_thread_node_id.py
"""

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "lib"))

import github  # noqa: E402


def main() -> int:
    """Resolve once with a node id and once without, counting the lookups."""
    lookups: list[str] = []
    mutations: list[dict] = []

    github._thread_node_id = lambda number, comment_id, repo_slug: (
        lookups.append(comment_id) or "looked-up-node"
    )
    github._graphql = lambda query, variables: (
        mutations.append(variables) or {"data": {}}
    )

    github.resolve_thread("1", "42", "owner/repo", node_id="given-node")
    assert lookups == [], f"node_id was supplied but the lookup ran anyway: {lookups}"
    assert mutations[-1]["threadId"] == "given-node", mutations[-1]

    github.resolve_thread("1", "42", "owner/repo")
    assert lookups == ["42"], f"node_id omitted, so exactly one lookup is due: {lookups}"
    assert mutations[-1]["threadId"] == "looked-up-node", mutations[-1]

    print("ok — resolve_thread honours node_id and falls back when absent")
    return 0


if __name__ == "__main__":
    sys.exit(main())

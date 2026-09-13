#!/usr/bin/env python3
"""Check that harvesting comments concurrently keeps pull-request order.

The harvest report is meant to be diffed against the previous sprint's. If the
comments landed in completion order instead of pull-request order, two runs over
the same window would produce different files and every diff would be noise —
without anything failing.

Run: python3 plugins/pr-workflows/tests/test_harvest_comment_order.py
"""

import os
import random
import sys
import time

SCRIPTS = os.path.join(
    os.path.dirname(os.path.abspath(__file__)),
    "..", "skills", "pr-feedback-harvest", "scripts",
)
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "lib"))
sys.path.insert(0, SCRIPTS)

import harvest  # noqa: E402


def main() -> int:
    """Fetch with deliberately uneven delays and assert the order survives."""
    pull_requests = [{"number": n} for n in range(12)]

    def slow_uneven_fetch(pull_request):
        # Later pull requests finish first, so completion order is the reverse
        # of the input; only an order-preserving collect passes.
        time.sleep(random.uniform(0, 0.02) + (12 - pull_request["number"]) * 0.005)
        return [{"pr": pull_request["number"]}]

    harvest.fetch_comments = slow_uneven_fetch

    from concurrent.futures import ThreadPoolExecutor

    with ThreadPoolExecutor(max_workers=harvest.COMMENT_FETCH_WORKERS) as pool:
        per_pull_request = pool.map(harvest.fetch_comments, pull_requests)
    all_comments = [c for comments in per_pull_request for c in comments]

    assert [c["pr"] for c in all_comments] == list(range(12)), all_comments
    assert harvest.COMMENT_FETCH_WORKERS > 1, "workers must actually be concurrent"

    print("ok — concurrent comment fetch preserves pull-request order")
    return 0


if __name__ == "__main__":
    sys.exit(main())

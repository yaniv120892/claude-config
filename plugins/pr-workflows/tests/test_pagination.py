#!/usr/bin/env python3
"""Check that check-runs and review threads are read past the first page.

Both reads fail silently when truncated rather than erroring: a failing check on
page 2 reads as `success` (and `verify-pr-state` auto-merges on it), and a thread
on page 2 reads as absent (so `resolve_thread` reports "no review thread found"
for a thread that exists). Neither shows up without an explicit multi-page case.

Run: python3 plugins/pr-workflows/tests/test_pagination.py
"""

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "lib"))

import github  # noqa: E402


def check_ci_paginates() -> None:
    """A failure on the second page must still produce a failed verdict."""
    passing = [
        {"status": "completed", "conclusion": "success", "html_url": "u"}
        for _ in range(100)
    ]
    failing = [{"status": "completed", "conclusion": "failure", "html_url": "bad-url"}]
    pages = {1: passing, 2: failing}
    requested: list[int] = []

    def fake_api(path, method=None, fields=None):
        page = int(path.split("&page=")[1])
        requested.append(page)
        return {"check_runs": pages[page], "total_count": 101}

    github.api = fake_api
    github.view_pull_request = lambda number, repo_slug=None: {
        "head_sha": "sha",
        "web_url": "pr-url",
    }

    status = github.latest_ci_status("1", "owner/repo")
    assert requested == [1, 2], f"expected both pages to be read: {requested}"
    assert status["state"] == "failed", f"page-2 failure was missed: {status}"
    assert status["web_url"] == "bad-url", status


def check_threads_paginate() -> None:
    """A thread on the second page must be visible and resolvable."""
    def node(database_id: int) -> dict:
        return {
            "isResolved": False,
            "resolvedBy": None,
            "path": "src/thing.ts",
            "line": 1,
            "originalLine": 1,
            "id": f"node-{database_id}",
            "comments": {
                "nodes": [
                    {
                        "databaseId": database_id,
                        "author": {"login": "reviewer"},
                        "body": "b",
                    }
                ]
            },
        }

    pages = [
        {"nodes": [node(i) for i in range(100)],
         "pageInfo": {"hasNextPage": True, "endCursor": "c1"}},
        {"nodes": [node(101)], "pageInfo": {"hasNextPage": False, "endCursor": None}},
    ]
    cursors: list = []

    def fake_graphql(query, variables):
        cursors.append(variables["cursor"])
        page = pages[0] if variables["cursor"] is None else pages[1]
        return {"data": {"repository": {"pullRequest": {"reviewThreads": page}}}}

    github._graphql = fake_graphql

    threads = github.list_review_threads("1", "owner/repo")
    assert cursors == [None, "c1"], f"cursor was not followed: {cursors}"
    assert len(threads) == 101, f"second page dropped: {len(threads)}"
    assert threads[-1]["thread_id"] == "101", threads[-1]

    cursors.clear()
    assert github._thread_node_id("1", "101", "owner/repo") == "node-101"


def main() -> int:
    """Run both pagination checks."""
    check_ci_paginates()
    check_threads_paginate()
    print("ok — check runs and review threads are read past the first page")
    return 0


if __name__ == "__main__":
    sys.exit(main())

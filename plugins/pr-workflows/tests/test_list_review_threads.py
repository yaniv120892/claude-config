#!/usr/bin/env python3
"""Check that list_review_threads maps a GraphQL reviewThreads payload correctly.

Run: python3 plugins/pr-workflows/tests/test_list_review_threads.py
"""

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "lib"))

import github  # noqa: E402


def thread_node(
    database_id: int,
    login: str,
    is_resolved: bool,
    resolved_by: dict | None,
    comments: list | None = None,
) -> dict:
    """Build one reviewThreads node the way GraphQL returns it."""
    return {
        "isResolved": is_resolved,
        "resolvedBy": resolved_by,
        "path": "src/thing.ts",
        "line": None,
        "originalLine": 42,
        "comments": {
            "nodes": comments
            if comments is not None
            else [{"databaseId": database_id, "author": {"login": login}, "body": "b"}]
        },
    }


def main() -> int:
    """Run the checks against a stubbed GraphQL response."""
    nodes = [
        thread_node(1, "reviewer", False, None),
        thread_node(2, "reviewer", True, {"login": "author"}),
        thread_node(3, "ghost-deleted-user", True, {"login": "reviewer"}, comments=[]),
    ]
    github._graphql = lambda query, variables: {
        "data": {"repository": {"pullRequest": {"reviewThreads": {"nodes": nodes}}}}
    }

    threads = github.list_review_threads("1", "owner/repo")

    # The empty-comments node is skipped, so it never reaches the mapping.
    assert len(threads) == 2, threads
    assert [t["thread_id"] for t in threads] == ["1", "2"], threads
    assert [t["resolved"] for t in threads] == [False, True], threads
    assert [t["resolved_by"] for t in threads] == [None, "author"], threads
    # line is null until a thread's diff hunk survives a force-push; fall back.
    assert threads[0]["line"] == 42, threads[0]
    assert threads[0]["file_path"] == "src/thing.ts", threads[0]

    print("ok — list_review_threads maps resolution, authorship, and line fallback")
    return 0


if __name__ == "__main__":
    sys.exit(main())

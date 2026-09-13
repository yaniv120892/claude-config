#!/usr/bin/env python3
"""Check that post_inline_comment pins to a supplied head SHA without re-fetching.

A batch review posts many comments per pull request. Dropping the head_sha
argument at the call site still passes every other test — it just silently costs
one `gh pr view` per comment — so the skip is asserted here directly.

Run: python3 plugins/pr-workflows/tests/test_post_inline_comment_head_sha.py
"""

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "lib"))

import github  # noqa: E402


def main() -> int:
    """Run the checks against a stubbed API and a counted view_pull_request."""
    views: list[str] = []
    posted: list[dict] = []

    github.view_pull_request = lambda number, repo_slug=None: (
        views.append(number) or {"head_sha": "fetched-sha"}
    )
    github.api = lambda path, method=None, fields=None: (
        posted.append(fields) or {"id": len(posted)}
    )

    github.post_inline_comment(
        number="1",
        file_path="src/thing.ts",
        body="b",
        new_line=42,
        repo_slug="owner/repo",
        head_sha="given-sha",
    )
    assert views == [], f"head_sha was supplied but the PR was fetched anyway: {views}"
    assert posted[-1]["commit_id"] == "given-sha", posted[-1]

    github.post_inline_comment(
        number="1",
        file_path="src/thing.ts",
        body="b",
        new_line=42,
        repo_slug="owner/repo",
    )
    assert views == ["1"], f"head_sha omitted, so exactly one fetch is due: {views}"
    assert posted[-1]["commit_id"] == "fetched-sha", posted[-1]

    print("ok — post_inline_comment honours head_sha and falls back when absent")
    return 0


if __name__ == "__main__":
    sys.exit(main())

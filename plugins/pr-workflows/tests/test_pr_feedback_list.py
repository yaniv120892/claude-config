#!/usr/bin/env python3
"""Check which threads `pr_feedback.py list` keeps.

A thread is answered only when it has a reply and that reply is mine. Filtering
by who opened the thread hid every comment the author left on their own diff;
filtering by who spoke last hid them too, since an unanswered comment's author
is also its most recent voice. Both mistakes are silent, so both get a case.

Run: python3 plugins/pr-workflows/tests/test_pr_feedback_list.py
"""

import io
import json
import os
import sys
from contextlib import redirect_stdout

_HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(_HERE, "..", "lib"))
sys.path.insert(0, os.path.join(_HERE, "..", "skills", "address-pr-feedback"))

import github  # noqa: E402
import pr_feedback  # noqa: E402

ME = "author"

def thread(thread_id: str, author: str, last_author: str, reply_count: int) -> dict:
    """Build one mapped thread the way `list_review_threads` returns it."""
    return {
        "thread_id": thread_id,
        "author": author,
        "last_author": last_author,
        "reply_count": reply_count,
    }


THREADS = [
    # A reviewer's comment nobody has answered.
    thread("1", "reviewer", "reviewer", 0),
    # A reviewer's comment I already answered.
    thread("2", "reviewer", ME, 1),
    # My own comment, no reply yet — the case both earlier filters swallowed.
    thread("3", ME, ME, 0),
    # My own comment a reviewer pushed back on.
    thread("4", ME, "reviewer", 1),
    # My own comment I already answered.
    thread("5", ME, ME, 1),
]


def listed(include_answered: bool) -> list[dict]:
    """Run the list subcommand against stubbed threads and return its output."""
    github.current_username = lambda: ME
    github.list_review_threads = lambda number, repo_slug: THREADS
    captured = io.StringIO()
    with redirect_stdout(captured):
        pr_feedback.run_list("1", "owner/repo", include_answered)
    return json.loads(captured.getvalue())["threads"]


def main() -> int:
    """Run the checks."""
    waiting = listed(include_answered=False)
    ids = [entry["thread_id"] for entry in waiting]

    # 3 is the regression: my own comment, unanswered. Dropped by the
    # opened-by-me filter and by a spoke-last filter alike.
    assert ids == ["1", "3", "4"], ids
    assert [entry["yours"] for entry in waiting] == [False, True, True], waiting
    assert all(entry["answered"] is False for entry in waiting), waiting

    everything = [entry["thread_id"] for entry in listed(include_answered=True)]
    assert everything == ["1", "2", "3", "4", "5"], everything

    print("ok — list keeps threads whose last note is not mine, --all keeps the rest")
    return 0


if __name__ == "__main__":
    sys.exit(main())

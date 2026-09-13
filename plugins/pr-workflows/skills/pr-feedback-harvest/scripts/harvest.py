#!/usr/bin/env python3
"""Harvest review comments on your merged pull requests for a feedback retro.

Pulls pull requests you authored and merged inside a date window across one or
more scopes, fetches every review comment, and splits them into
human-reviewer / self-review / automation buckets. The point is to see which
comments reviewers keep repeating, so a recurring one can be promoted into a
rule, skill, or hook instead of being re-explained every sprint.

A scope is a GitHub org or user.

Example:
    python3 harvest.py --scope my-org --scope my-other-org \\
        --exclude-repo scratch-repo --since-days 14 --out-dir ./retro
"""

import argparse
import json
import os
import sys
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from datetime import date, timedelta
from typing import Any
from urllib.parse import quote

# Inside an installed plugin this is set for us; when the script is run straight
# from a clone, fall back to walking up to the plugin root.
_PLUGIN_ROOT = os.environ.get("CLAUDE_PLUGIN_ROOT") or os.path.abspath(
    os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "..")
)
sys.path.insert(0, os.path.join(_PLUGIN_ROOT, "lib"))

import github  # noqa: E402


# Accounts that post automated, non-review noise. Extend as you discover more.
NOISE_AUTHOR_SUBSTRINGS = ("service_account", "_bot_", "semantic-release", "[bot]")

# Concurrent `gh api` calls when reading each pull request's comments. Kept well
# under GitHub's secondary rate limit, which throttles bursts of concurrent
# requests from one token regardless of the hourly quota.
COMMENT_FETCH_WORKERS = 8


def main() -> int:
    """Harvest comments for every configured scope and write the report.

    Returns:
        Process exit code: 0 on success, 1 on failure.
    """
    arguments = parse_arguments()
    since_date = (date.today() - timedelta(days=arguments.since_days)).isoformat()

    try:
        github.require_cli()
        author = arguments.author or github.current_username()
    except github.GitHubError as error:
        print(f"error: {error}", file=sys.stderr)
        return 1

    pull_requests: list[dict[str, Any]] = []
    for scope in arguments.scope:
        pull_requests += collect_pull_requests(
            scope, author, since_date, arguments.exclude_repo
        )

    if not pull_requests:
        print(f"No merged pull requests by {author} since {since_date}.")
        return 0

    # One `gh` subprocess per pull request, and a sprint's harvest spans dozens
    # across several repositories. They are independent reads, so the wall clock
    # is the sum of them only if they run one at a time. Ordered by pull request
    # so a rerun of the same window produces a byte-identical report to diff.
    with ThreadPoolExecutor(max_workers=COMMENT_FETCH_WORKERS) as pool:
        per_pull_request = pool.map(fetch_comments, pull_requests)

    all_comments: list[dict[str, Any]] = [
        comment for comments in per_pull_request for comment in comments
    ]

    buckets = bucket_comments(all_comments, author)
    report = {
        "author": author,
        "since": since_date,
        "pull_request_count": len(pull_requests),
        "comment_counts": {name: len(items) for name, items in buckets.items()},
        "top_reviewers": Counter(
            comment["author"] for comment in buckets["human"]
        ).most_common(10),
        "pull_requests": pull_requests,
        "comments": buckets,
    }

    os.makedirs(arguments.out_dir, exist_ok=True)
    output_path = os.path.join(arguments.out_dir, f"pr-feedback-{since_date}.json")
    with open(output_path, "w", encoding="utf-8") as output_file:
        json.dump(report, output_file, indent=2)

    print(
        f"{len(pull_requests)} pull requests, "
        f"{len(buckets['human'])} human comments, "
        f"{len(buckets['self'])} self-review, {len(buckets['noise'])} noise"
    )
    print(f"Wrote {output_path}")
    return 0


def collect_pull_requests(
    scope: str,
    author: str,
    since_date: str,
    excluded_repositories: list[str],
) -> list[dict[str, Any]]:
    """Search for merged pull requests the author owns within one org or user.

    Args:
        scope: Org or user login.
        author: Username whose pull requests to collect.
        since_date: ISO date lower bound on the merge date.
        excluded_repositories: Substrings of repo names to skip.

    Returns:
        A list of pull-request dicts.
    """
    query = quote(
        f"is:pr is:merged author:{author} org:{scope} merged:>={since_date}", safe=""
    )
    collected = []
    page = 1
    while True:
        response = github.api(f"search/issues?q={query}&per_page=100&page={page}") or {}
        items = response.get("items", [])
        if not items:
            break
        for item in items:
            repository = item["repository_url"].split("/repos/", 1)[1]
            if any(excluded in repository for excluded in excluded_repositories):
                continue
            collected.append(
                {
                    "number": str(item["number"]),
                    "repo": repository,
                    "title": item["title"],
                    "merged_at": (item.get("closed_at") or "")[:10],
                    "web_url": item["html_url"],
                    "author": item["user"]["login"],
                }
            )
        # GitHub's search API refuses to page past 1000 results.
        if len(items) < 100 or page * 100 >= 1000:
            if page * 100 >= 1000:
                print(
                    f"warning: hit GitHub's 1000-result search cap for scope {scope}; "
                    "narrow --since-days to see the rest",
                    file=sys.stderr,
                )
            break
        page += 1
    return collected


def fetch_comments(pull_request: dict[str, Any]) -> list[dict[str, Any]]:
    """Fetch every review comment on one pull request.

    Args:
        pull_request: A dict from `collect_pull_requests`.

    Returns:
        A list of normalised comment dicts.
    """
    comments = (
        github.api(
            f"repos/{pull_request['repo']}/pulls/{pull_request['number']}"
            f"/comments?per_page=100",
        )
        or []
    )
    return [
        {
            "repo": pull_request["repo"],
            "author": comment["user"]["login"],
            "is_bot": comment["user"]["type"] == "Bot",
            "created_at": (comment.get("created_at") or "")[:10],
            "file": comment.get("path"),
            "line": comment.get("line") or comment.get("original_line"),
            "body": (comment.get("body") or "").strip(),
        }
        for comment in comments
    ]


def is_noise(author: str) -> bool:
    """Decide whether an author is an automation account rather than a reviewer.

    Args:
        author: The comment author's username.

    Returns:
        True when the author looks automated.
    """
    return any(substring in author for substring in NOISE_AUTHOR_SUBSTRINGS)


def bucket_comments(
    comments: list[dict[str, Any]], author: str
) -> dict[str, list[dict[str, Any]]]:
    """Split comments into human-reviewer, self-review, and automation buckets.

    Args:
        comments: Normalised comment dicts.
        author: The pull-request author, whose own comments are self-review.

    Returns:
        A dict with `human`, `self`, and `noise` keys.
    """
    human: list[dict[str, Any]] = []
    self_review: list[dict[str, Any]] = []
    noise: list[dict[str, Any]] = []
    for comment in comments:
        if comment["is_bot"] or is_noise(comment["author"]):
            noise.append(comment)
        elif comment["author"] == author:
            self_review.append(comment)
        else:
            human.append(comment)
    return {"human": human, "self": self_review, "noise": noise}


def parse_arguments() -> argparse.Namespace:
    """Define and parse the command-line arguments.

    Returns:
        The parsed argument namespace.
    """
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--scope",
        action="append",
        required=True,
        help="GitHub org or user (repeatable)",
    )
    parser.add_argument(
        "--author", default=None, help="Defaults to the authenticated user"
    )
    parser.add_argument("--since-days", type=int, default=14)
    parser.add_argument("--exclude-repo", action="append", default=[])
    parser.add_argument("--out-dir", default=".")
    return parser.parse_args()


if __name__ == "__main__":
    sys.exit(main())

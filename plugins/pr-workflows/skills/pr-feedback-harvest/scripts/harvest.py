#!/usr/bin/env python3
"""Harvest review comments on your merged change requests for a feedback retro.

Pulls change requests you authored and merged inside a date window across one or
more scopes, fetches every review comment, and splits them into
human-reviewer / self-review / automation buckets. The point is to see which
comments reviewers keep repeating, so a recurring one can be promoted into a
rule, skill, or hook instead of being re-explained every sprint.

Works on GitHub and GitLab. A scope is a GitHub org or user, or a GitLab group
path (subgroups included).

Example:
    python3 harvest.py --scope my-org --scope my-other-org \\
        --exclude-repo scratch-repo --since-days 14 --out-dir ./retro
"""

import argparse
import json
import os
import sys
from collections import Counter
from datetime import date, timedelta
from typing import Any
from urllib.parse import quote

# Inside an installed plugin this is set for us; when the script is run straight
# from a clone, fall back to walking up to the plugin root.
_PLUGIN_ROOT = os.environ.get("CLAUDE_PLUGIN_ROOT") or os.path.abspath(
    os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "..")
)
sys.path.insert(0, os.path.join(_PLUGIN_ROOT, "lib"))

import forge  # noqa: E402


# Accounts that post automated, non-review noise. Extend as you discover more.
NOISE_AUTHOR_SUBSTRINGS = ("service_account", "_bot_", "semantic-release", "[bot]")


def main() -> int:
    """Harvest comments for every configured scope and write the report.

    Returns:
        Process exit code: 0 on success, 1 on failure.
    """
    arguments = parse_arguments()
    since_date = (date.today() - timedelta(days=arguments.since_days)).isoformat()

    try:
        forge_name = arguments.forge or forge.detect_forge()
        forge.require_cli(forge_name)
        author = arguments.author or resolve_author(forge_name)
    except forge.ForgeError as error:
        print(f"error: {error}", file=sys.stderr)
        return 1

    change_requests: list[dict[str, Any]] = []
    for scope in arguments.scope:
        change_requests += collect_change_requests(
            scope, author, since_date, arguments.exclude_repo, forge_name
        )

    if not change_requests:
        print(f"No merged change requests by {author} since {since_date}.")
        return 0

    all_comments: list[dict[str, Any]] = []
    for change_request in change_requests:
        all_comments += fetch_comments(change_request, forge_name)

    buckets = bucket_comments(all_comments, author)
    report = {
        "forge": forge_name,
        "author": author,
        "since": since_date,
        "change_request_count": len(change_requests),
        "comment_counts": {name: len(items) for name, items in buckets.items()},
        "top_reviewers": Counter(
            comment["author"] for comment in buckets["human"]
        ).most_common(10),
        "change_requests": change_requests,
        "comments": buckets,
    }

    os.makedirs(arguments.out_dir, exist_ok=True)
    output_path = os.path.join(arguments.out_dir, f"pr-feedback-{since_date}.json")
    with open(output_path, "w", encoding="utf-8") as output_file:
        json.dump(report, output_file, indent=2)

    print(
        f"{len(change_requests)} change requests, "
        f"{len(buckets['human'])} human comments, "
        f"{len(buckets['self'])} self-review, {len(buckets['noise'])} noise"
    )
    print(f"Wrote {output_path}")
    return 0


def resolve_author(forge_name: str) -> str:
    """Resolve the authenticated username to filter change requests by.

    Args:
        forge_name: Either `forge.GITHUB` or `forge.GITLAB`.

    Returns:
        The authenticated username.
    """
    user: Any = forge.api(forge_name, "user")
    return user["login"] if forge_name == forge.GITHUB else user["username"]


def collect_change_requests(
    scope: str,
    author: str,
    since_date: str,
    excluded_repositories: list[str],
    forge_name: str,
) -> list[dict[str, Any]]:
    """List merged change requests the author owns within one scope.

    Args:
        scope: GitHub org or user, or GitLab group path.
        author: Username whose change requests to collect.
        since_date: ISO date; change requests merged before it are dropped.
        excluded_repositories: Substrings of repo names to skip.
        forge_name: Either `forge.GITHUB` or `forge.GITLAB`.

    Returns:
        A list of dicts describing each change request.
    """
    if forge_name == forge.GITHUB:
        return _collect_github(scope, author, since_date, excluded_repositories)
    return _collect_gitlab(scope, author, since_date, excluded_repositories)


def _collect_github(
    scope: str, author: str, since_date: str, excluded_repositories: list[str]
) -> list[dict[str, Any]]:
    """Search GitHub for merged pull requests by the author in one org or user.

    Args:
        scope: Org or user login.
        author: Username whose pull requests to collect.
        since_date: ISO date lower bound on the merge date.
        excluded_repositories: Substrings of repo names to skip.

    Returns:
        A list of change-request dicts.
    """
    query = quote(
        f"is:pr is:merged author:{author} org:{scope} merged:>={since_date}", safe=""
    )
    collected = []
    page = 1
    while True:
        response = (
            forge.api(
                forge.GITHUB, f"search/issues?q={query}&per_page=100&page={page}"
            )
            or {}
        )
        items = response.get("items", [])
        if not items:
            break
        for item in items:
            repository = item["repository_url"].split("/repos/", 1)[1]
            if any(excluded in repository for excluded in excluded_repositories):
                continue
            collected.append(
                {
                    "project_id": None,
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


def _collect_gitlab(
    scope: str, author: str, since_date: str, excluded_repositories: list[str]
) -> list[dict[str, Any]]:
    """Page through a GitLab group's merged merge requests by the author.

    Args:
        scope: Group path, subgroups included.
        author: Username whose merge requests to collect.
        since_date: ISO date lower bound on the merge date.
        excluded_repositories: Substrings of repo names to skip.

    Returns:
        A list of change-request dicts.
    """
    encoded_scope = quote(scope, safe="")
    collected = []
    page = 1
    while True:
        response = forge.api(
            forge.GITLAB,
            f"groups/{encoded_scope}/merge_requests?state=merged"
            f"&author_username={author}&per_page=100&page={page}"
            f"&updated_after={since_date}T00:00:00Z",
        )
        if not isinstance(response, list) or not response:
            break
        for merge_request in response:
            if (merge_request.get("merged_at") or "")[:10] < since_date:
                continue
            repository = merge_request["references"]["full"].split("!")[0]
            if any(excluded in repository for excluded in excluded_repositories):
                continue
            collected.append(
                {
                    "project_id": merge_request["project_id"],
                    "number": str(merge_request["iid"]),
                    "repo": repository,
                    "title": merge_request["title"],
                    "merged_at": merge_request["merged_at"][:10],
                    "web_url": merge_request["web_url"],
                    "author": merge_request["author"]["username"],
                }
            )
        page += 1
    return collected


def fetch_comments(
    change_request: dict[str, Any], forge_name: str
) -> list[dict[str, Any]]:
    """Fetch every review comment on one change request.

    Args:
        change_request: A dict from `collect_change_requests`.
        forge_name: Either `forge.GITHUB` or `forge.GITLAB`.

    Returns:
        A list of normalised comment dicts.
    """
    if forge_name == forge.GITHUB:
        comments = (
            forge.api(
                forge.GITHUB,
                f"repos/{change_request['repo']}/pulls/{change_request['number']}"
                f"/comments?per_page=100",
            )
            or []
        )
        return [
            {
                "repo": change_request["repo"],
                "author": comment["user"]["login"],
                "is_bot": comment["user"]["type"] == "Bot",
                "created_at": (comment.get("created_at") or "")[:10],
                "file": comment.get("path"),
                "line": comment.get("line") or comment.get("original_line"),
                "body": (comment.get("body") or "").strip(),
            }
            for comment in comments
        ]

    collected = []
    page = 1
    while True:
        discussions = forge.api(
            forge.GITLAB,
            f"projects/{change_request['project_id']}/merge_requests"
            f"/{change_request['number']}/discussions?per_page=100&page={page}",
        )
        if not isinstance(discussions, list) or not discussions:
            break
        for discussion in discussions:
            for note in discussion.get("notes", []):
                if note.get("system"):
                    continue
                position = note.get("position") or {}
                note_author = note.get("author") or {}
                collected.append(
                    {
                        "repo": change_request["repo"],
                        "author": note_author.get("username") or "",
                        "is_bot": bool(note_author.get("bot")),
                        "created_at": (note.get("created_at") or "")[:10],
                        "file": position.get("new_path") or position.get("old_path"),
                        "line": position.get("new_line") or position.get("old_line"),
                        "body": (note.get("body") or "").strip(),
                    }
                )
        page += 1
    return collected


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
        author: The change-request author, whose own comments are self-review.

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
        help="GitHub org/user or GitLab group path (repeatable)",
    )
    parser.add_argument("--author", default=None, help="Defaults to the authenticated user")
    parser.add_argument("--since-days", type=int, default=14)
    parser.add_argument("--exclude-repo", action="append", default=[])
    parser.add_argument("--out-dir", default=".")
    parser.add_argument("--forge", default=None, choices=[forge.GITHUB, forge.GITLAB])
    return parser.parse_args()


if __name__ == "__main__":
    sys.exit(main())

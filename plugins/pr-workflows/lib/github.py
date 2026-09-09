#!/usr/bin/env python3
"""GitHub helpers for pull request automation.

Every request goes through `gh api`, so authentication, the configured host, and
enterprise instances are the CLI's problem rather than this module's.

Import it from a skill script in this plugin with:

    import os
    import sys

    sys.path.insert(0, os.path.join(os.environ["CLAUDE_PLUGIN_ROOT"], "lib"))
    import github

Scripts here resolve CLAUDE_PLUGIN_ROOT with a walk-up fallback, so they also
work when run directly from a clone.
"""

import argparse
import json
import subprocess
import sys
from typing import Any


# `git remote get-url` is read by both the smoke test and slug resolution; cache
# it so one logical operation does not spawn git twice for the same answer.
_remote_url_cache: dict[str, str] = {}


class GitHubError(RuntimeError):
    """Raised when the `gh` CLI is missing, unauthenticated, or returns an error."""


def origin_url(repo_directory: str | None = None) -> str:
    """Read the repository's `origin` remote, once per directory per process.

    Args:
        repo_directory: Repository to inspect; defaults to the current directory.

    Returns:
        The remote URL, stripped.

    Raises:
        GitHubError: If the remote cannot be read.
    """
    cache_key = repo_directory or ""
    if cache_key in _remote_url_cache:
        return _remote_url_cache[cache_key]

    git_command = ["git"]
    if repo_directory is not None:
        git_command += ["-C", repo_directory]
    git_command += ["remote", "get-url", "origin"]

    try:
        completed_process = subprocess.run(
            git_command, capture_output=True, text=True, check=True
        )
    except (FileNotFoundError, subprocess.CalledProcessError) as error:
        raise GitHubError(f"could not read the origin remote: {error}") from error

    _remote_url_cache[cache_key] = completed_process.stdout.strip()
    return _remote_url_cache[cache_key]


def require_cli() -> None:
    """Assert that `gh` is installed and authenticated.

    Every entry point calls this before doing anything else, so a missing login
    surfaces as one clear message instead of a failure per API call.

    Raises:
        GitHubError: If `gh` is absent or not authenticated.
    """
    try:
        subprocess.run(
            ["gh", "auth", "status"], capture_output=True, text=True, check=True
        )
    except FileNotFoundError as error:
        raise GitHubError(
            "gh CLI not found — install it and run `gh auth login`"
        ) from error
    except subprocess.CalledProcessError as error:
        raise GitHubError("gh is not authenticated — run `gh auth login`") from error


def current_username() -> str:
    """Return the authenticated user's login.

    Returns:
        The authenticated username.

    Raises:
        GitHubError: If the user cannot be resolved.
    """
    user: Any = api("user")
    return user["login"]


def add_pull_request_arguments(parser: argparse.ArgumentParser) -> None:
    """Add the `--pr` and `--repo` flags every entry point takes.

    Args:
        parser: The parser or subparser to add them to.
    """
    parser.add_argument("--pr", required=True, help="Pull request number")
    parser.add_argument(
        "--repo", default=None, help="Repo slug; defaults to the origin remote"
    )


def api(
    path: str,
    method: str = "GET",
    fields: dict[str, Any] | None = None,
) -> Any:
    """Call GitHub's REST API through `gh`, which handles authentication.

    Routing every request through `gh api` avoids reading tokens out of CLI
    config files, which is brittle and leaks credentials into scripts. It also
    means the CLI's own configured host is used, so an enterprise instance works
    without this module knowing its hostname.

    Args:
        path: API path relative to the API root, already URL-encoded and
            carrying the repository slug where the endpoint needs one.
        method: HTTP method.
        fields: JSON body sent for non-GET requests.

    Returns:
        The decoded JSON response, or the raw text when it is not JSON.

    Raises:
        GitHubError: If the request fails.
    """
    command = ["gh", "api", path, "--method", method.upper()]

    input_payload = None
    if fields is not None:
        command += ["--input", "-"]
        input_payload = json.dumps(fields)

    try:
        completed_process = subprocess.run(
            command, capture_output=True, text=True, check=True, input=input_payload
        )
    except FileNotFoundError as error:
        raise GitHubError("gh CLI not found") from error
    except subprocess.CalledProcessError as error:
        raise GitHubError(f"gh api {path} failed: {error.stderr.strip()}") from error

    output = completed_process.stdout.strip()
    if not output:
        return None
    try:
        return json.loads(output)
    except json.JSONDecodeError:
        return output


def view_pull_request(number: str, repo_slug: str | None = None) -> dict[str, Any]:
    """Fetch a pull request, normalised to the keys the skills read.

    Args:
        number: Pull request number.
        repo_slug: Optional repository slug.

    Returns:
        A dict with `number`, `title`, `author`, `state`, `source_branch`,
        `target_branch`, `head_sha`, and `web_url`.

    Raises:
        GitHubError: If the pull request cannot be read.
    """
    command = [
        "gh", "pr", "view", number,
        "--json",
        "number,title,author,state,headRefName,baseRefName,headRefOid,url",
    ]
    if repo_slug is not None:
        command += ["--repo", repo_slug]
    raw = _run_json(command)
    return {
        "number": str(raw["number"]),
        "title": raw["title"],
        "author": raw["author"]["login"],
        "state": raw["state"],
        "source_branch": raw["headRefName"],
        "target_branch": raw["baseRefName"],
        "head_sha": raw["headRefOid"],
        "web_url": raw["url"],
    }


def _run_json(command: list[str]) -> dict[str, Any]:
    """Run a `gh` command that emits JSON and decode it.

    Args:
        command: The full command line.

    Returns:
        The decoded JSON object.

    Raises:
        GitHubError: If the command fails or its output is not JSON.
    """
    try:
        completed_process = subprocess.run(
            command, capture_output=True, text=True, check=True
        )
    except FileNotFoundError as error:
        raise GitHubError("gh CLI not found") from error
    except subprocess.CalledProcessError as error:
        raise GitHubError(
            f"{' '.join(command)} failed: {error.stderr.strip()}"
        ) from error

    try:
        return json.loads(completed_process.stdout)
    except json.JSONDecodeError as error:
        raise GitHubError(f"could not parse gh output: {error}") from error


def resolve_base_sha(pull_request: dict[str, Any]) -> str | None:
    """Return the pull request's base SHA, derived locally.

    GitHub does not report a merge base on the pull request itself, so it has to
    come from `git merge-base`, which means the repository must be fetched for
    the answer to be current. Only callers that read the value pay for it.

    Args:
        pull_request: A dict from `view_pull_request`.

    Returns:
        The merge-base SHA, or None when it cannot be resolved locally.
    """
    try:
        completed_process = subprocess.run(
            [
                "git", "merge-base",
                f"origin/{pull_request['target_branch']}",
                pull_request["head_sha"],
            ],
            capture_output=True,
            text=True,
            check=True,
        )
    except (FileNotFoundError, subprocess.CalledProcessError):
        return None
    return completed_process.stdout.strip() or None


def post_inline_comment(
    number: str,
    file_path: str,
    body: str,
    new_line: int | None = None,
    old_line: int | None = None,
    repo_slug: str | None = None,
) -> str:
    """Post a comment pinned to a line of the diff, not a general note.

    Args:
        number: Pull request number.
        file_path: File path as it appears in the diff.
        body: Comment text.
        new_line: New-side line number; set for an added or context line.
        old_line: Old-side line number; set for a removed or context line.
        repo_slug: Optional repository slug.

    Returns:
        The created comment id, as a string.

    Raises:
        GitHubError: If neither line number is supplied, or the request fails.
    """
    if new_line is None and old_line is None:
        raise GitHubError("at least one of new_line or old_line is required")

    pull_request = view_pull_request(number, repo_slug)
    target_slug = repo_slug or current_repo_slug()
    response = api(
        f"repos/{target_slug}/pulls/{number}/comments",
        method="POST",
        fields={
            "body": body,
            "commit_id": pull_request["head_sha"],
            "path": file_path,
            "side": "RIGHT" if new_line is not None else "LEFT",
            "line": new_line if new_line is not None else old_line,
        },
    )
    return str(response["id"])


def list_review_threads(
    number: str, repo_slug: str | None = None
) -> list[dict[str, Any]]:
    """List the inline review threads on a pull request.

    Args:
        number: Pull request number.
        repo_slug: Optional repository slug.

    Returns:
        A list of dicts with `thread_id`, `author`, `body`, `file_path`, `line`,
        `resolved`, and `resolved_by`, one entry per thread. `thread_id` is the
        opening comment's REST id, which is what `reply_to_thread` and
        `resolve_thread` take.

    Raises:
        GitHubError: If the threads cannot be read.
    """
    # GraphQL, not REST: resolution lives only here, and REST returns every
    # reply as its own comment with no way to group them back into threads.
    target_slug = repo_slug or current_repo_slug()
    owner, _, repository = target_slug.partition("/")
    query = (
        "query($owner:String!,$repo:String!,$number:Int!){repository(owner:$owner,"
        "name:$repo){pullRequest(number:$number){reviewThreads(first:100){nodes{"
        "isResolved resolvedBy{login} path line originalLine "
        "comments(first:1){nodes{databaseId author{login} body}}}}}}}"
    )
    payload = _graphql(query, {"owner": owner, "repo": repository, "number": number})
    threads = payload["data"]["repository"]["pullRequest"]["reviewThreads"]["nodes"]

    listed = []
    for thread in threads:
        comments = thread["comments"]["nodes"]
        if not comments:
            continue
        opening_comment = comments[0]
        resolved_by = thread.get("resolvedBy") or {}
        author = opening_comment.get("author") or {}
        listed.append(
            {
                "thread_id": str(opening_comment["databaseId"]),
                "author": author.get("login"),
                "body": opening_comment["body"],
                "file_path": thread.get("path"),
                "line": thread.get("line") or thread.get("originalLine"),
                "resolved": bool(thread["isResolved"]),
                "resolved_by": resolved_by.get("login"),
            }
        )
    return listed


def resolve_thread(number: str, thread_id: str, repo_slug: str | None = None) -> None:
    """Mark a review thread resolved.

    Thread resolution exists only in GraphQL, so the REST id from
    `list_review_threads` is mapped to its GraphQL node id first.

    Args:
        number: Pull request number.
        thread_id: Thread id from `list_review_threads`.
        repo_slug: Optional repository slug.

    Raises:
        GitHubError: If the thread cannot be resolved.
    """
    node_id = _thread_node_id(number, thread_id, repo_slug)
    mutation = (
        "mutation($threadId:ID!){resolveReviewThread(input:{threadId:$threadId})"
        "{thread{isResolved}}}"
    )
    _graphql(mutation, {"threadId": node_id})


def reply_to_thread(
    number: str,
    thread_id: str,
    body: str,
    repo_slug: str | None = None,
) -> str:
    """Post a reply inside an existing review thread rather than as a new note.

    Args:
        number: Pull request number.
        thread_id: Thread id from `list_review_threads`.
        body: Reply text.
        repo_slug: Optional repository slug.

    Returns:
        The created comment id, as a string.

    Raises:
        GitHubError: If the reply cannot be posted.
    """
    target_slug = repo_slug or current_repo_slug()
    response = api(
        f"repos/{target_slug}/pulls/{number}/comments/{thread_id}/replies",
        method="POST",
        fields={"body": body},
    )
    return str(response["id"])


def latest_ci_status(number: str, repo_slug: str | None = None) -> dict[str, Any]:
    """Report the CI outcome for a pull request's head commit.

    Args:
        number: Pull request number.
        repo_slug: Optional repository slug.

    Returns:
        A dict with `state` (one of `success`, `failed`, `running`, `unknown`)
        and `web_url`.

    Raises:
        GitHubError: If the status cannot be read.
    """
    pull_request = view_pull_request(number, repo_slug)
    target_slug = repo_slug or current_repo_slug()
    runs = (
        api(f"repos/{target_slug}/commits/{pull_request['head_sha']}/check-runs")
        or {}
    )
    check_runs = runs.get("check_runs") or []

    if not check_runs:
        return {"state": "unknown", "web_url": pull_request["web_url"]}
    if any(run["status"] != "completed" for run in check_runs):
        return {"state": "running", "web_url": pull_request["web_url"]}

    failed = [
        run for run in check_runs
        if run["conclusion"] not in ("success", "neutral", "skipped")
    ]
    return {
        "state": "failed" if failed else "success",
        "web_url": (failed[0]["html_url"] if failed else pull_request["web_url"]),
    }


def _thread_node_id(number: str, comment_id: str, repo_slug: str | None) -> str:
    """Find the GraphQL thread node id that owns a REST review-comment id.

    Args:
        number: Pull request number.
        comment_id: REST comment id.
        repo_slug: Optional `owner/repo`.

    Returns:
        The GraphQL thread node id.

    Raises:
        GitHubError: If no thread contains the comment.
    """
    target_slug = repo_slug or current_repo_slug()
    owner, _, repository = target_slug.partition("/")
    query = (
        "query($owner:String!,$repo:String!,$number:Int!){repository(owner:$owner,"
        "name:$repo){pullRequest(number:$number){reviewThreads(first:100){nodes{id "
        "comments(first:1){nodes{databaseId}}}}}}}"
    )
    payload = _graphql(query, {"owner": owner, "repo": repository, "number": number})
    threads = payload["data"]["repository"]["pullRequest"]["reviewThreads"]["nodes"]
    for thread in threads:
        comments = thread["comments"]["nodes"]
        if comments and str(comments[0]["databaseId"]) == str(comment_id):
            return thread["id"]
    raise GitHubError(f"no review thread found for comment {comment_id}")


def _graphql(query: str, variables: dict[str, Any]) -> Any:
    """Run a GraphQL query, which REST cannot express (thread resolution).

    Args:
        query: The GraphQL document.
        variables: Variables passed as `-F name=value`.

    Returns:
        The decoded response.

    Raises:
        GitHubError: If the call fails or returns GraphQL errors.
    """
    command = ["gh", "api", "graphql", "-f", f"query={query}"]
    for name, value in variables.items():
        command += ["-F", f"{name}={value}"]

    try:
        completed_process = subprocess.run(
            command, capture_output=True, text=True, check=True
        )
    except FileNotFoundError as error:
        raise GitHubError("gh CLI not found") from error
    except subprocess.CalledProcessError as error:
        raise GitHubError(f"gh api graphql failed: {error.stderr.strip()}") from error

    try:
        payload = json.loads(completed_process.stdout)
    except json.JSONDecodeError as error:
        raise GitHubError(f"could not parse gh graphql output: {error}") from error

    # GraphQL reports failures in the body with a 200, so check=True misses them.
    if payload.get("errors"):
        raise GitHubError(f"gh api graphql returned errors: {payload['errors']}")
    return payload


def current_repo_slug() -> str:
    """Resolve the current repository's `owner/repo` from its origin remote.

    The slug is everything after the host, so this works for an enterprise
    instance without knowing its hostname.

    Returns:
        `owner/repo`.

    Raises:
        GitHubError: If the remote cannot be parsed.
    """
    remote_url = origin_url().removesuffix(".git")

    # scp-style: git@host:owner/repo
    if "@" in remote_url and "://" not in remote_url:
        _, _, path = remote_url.partition(":")
        return path.strip("/")

    # URL form: scheme://[user@]host[:port]/owner/repo
    _, separator, after_scheme = remote_url.partition("://")
    if separator:
        _, _, path = after_scheme.partition("/")
        if path:
            return path.strip("/")

    raise GitHubError(f"could not derive a repo slug from {remote_url}")


def main() -> int:
    """Print the current repo slug, as a smoke test.

    Returns:
        Process exit code: 0 on success, 1 on failure.
    """
    try:
        print(f"repo={current_repo_slug()}")
    except GitHubError as error:
        print(f"error: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())

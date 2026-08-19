#!/usr/bin/env python3
"""Forge-agnostic helpers for pull/merge request automation.

Skills that drive a code-review workflow must work on both GitHub (`gh`) and
GitLab (`glab`). This module detects which forge a repository lives on and
exposes one normalised surface over both, so a skill's script never branches on
the forge itself.

Vocabulary is normalised to GitHub's: a "change request" is a pull request on
GitHub and a merge request on GitLab; `number` is a PR number or an MR IID.

Import it from a skill script in this plugin with:

    import os
    import sys

    sys.path.insert(0, os.path.join(os.environ["CLAUDE_PLUGIN_ROOT"], "lib"))
    import forge

Scripts here resolve CLAUDE_PLUGIN_ROOT with a walk-up fallback, so they also
work when run directly from a clone.
"""

import json
import subprocess
import sys
from typing import Any


GITHUB = "github"
GITLAB = "gitlab"

_FORGE_CLI = {GITHUB: "gh", GITLAB: "glab"}


class ForgeError(RuntimeError):
    """Raised when a forge CLI is missing, unauthenticated, or returns an error."""


def detect_forge(repo_directory: str | None = None) -> str:
    """Determine which forge the repository's `origin` remote points at.

    Args:
        repo_directory: Repository to inspect; defaults to the current directory.

    Returns:
        Either `GITHUB` or `GITLAB`.

    Raises:
        ForgeError: If there is no origin remote, or its host is not recognised.
    """
    git_command = ["git"]
    if repo_directory is not None:
        git_command += ["-C", repo_directory]
    git_command += ["remote", "get-url", "origin"]

    try:
        completed_process = subprocess.run(
            git_command, capture_output=True, text=True, check=True
        )
    except (FileNotFoundError, subprocess.CalledProcessError) as error:
        raise ForgeError(f"could not read the origin remote: {error}") from error

    remote_url = completed_process.stdout.strip().lower()
    if "github.com" in remote_url:
        return GITHUB
    if "gitlab" in remote_url:
        return GITLAB
    raise ForgeError(f"unrecognised forge for origin remote: {remote_url}")


def require_cli(forge_name: str) -> str:
    """Assert that the forge's CLI is installed and authenticated.

    Args:
        forge_name: Either `GITHUB` or `GITLAB`.

    Returns:
        The CLI executable name.

    Raises:
        ForgeError: If the CLI is absent or not authenticated.
    """
    cli_name = _FORGE_CLI[forge_name]
    try:
        subprocess.run(
            [cli_name, "auth", "status"], capture_output=True, text=True, check=True
        )
    except FileNotFoundError as error:
        raise ForgeError(
            f"{cli_name} CLI not found — install it and run `{cli_name} auth login`"
        ) from error
    except subprocess.CalledProcessError as error:
        raise ForgeError(
            f"{cli_name} is not authenticated — run `{cli_name} auth login`"
        ) from error
    return cli_name


def api(
    forge_name: str,
    path: str,
    method: str = "GET",
    fields: dict[str, Any] | None = None,
    repo_slug: str | None = None,
) -> Any:
    """Call the forge's REST API through its CLI, which handles authentication.

    Routing every request through `gh api` / `glab api` avoids reading tokens out
    of CLI config files, which is brittle and leaks credentials into scripts.

    Args:
        forge_name: Either `GITHUB` or `GITLAB`.
        path: API path relative to the forge's API root, already URL-encoded.
        method: HTTP method.
        fields: JSON body sent for non-GET requests.
        repo_slug: Optional `owner/repo` (GitHub) or `group/subgroup/repo` (GitLab).

    Returns:
        The decoded JSON response, or the raw text when it is not JSON.

    Raises:
        ForgeError: If the request fails.
    """
    cli_name = _FORGE_CLI[forge_name]
    command = [cli_name, "api", path, "--method", method.upper()]
    if repo_slug is not None and forge_name == GITHUB:
        command += ["--hostname", "github.com"]

    input_payload = None
    if fields is not None:
        command += ["--input", "-"]
        input_payload = json.dumps(fields)

    try:
        completed_process = subprocess.run(
            command, capture_output=True, text=True, check=True, input=input_payload
        )
    except FileNotFoundError as error:
        raise ForgeError(f"{cli_name} CLI not found") from error
    except subprocess.CalledProcessError as error:
        raise ForgeError(f"{cli_name} api {path} failed: {error.stderr.strip()}") from error

    output = completed_process.stdout.strip()
    if not output:
        return None
    try:
        return json.loads(output)
    except json.JSONDecodeError:
        return output


def view_change_request(
    number: str, forge_name: str, repo_slug: str | None = None
) -> dict[str, Any]:
    """Fetch a change request and normalise the fields both forges disagree on.

    Args:
        number: PR number or MR IID.
        forge_name: Either `GITHUB` or `GITLAB`.
        repo_slug: Optional repository slug.

    Returns:
        A dict with `number`, `title`, `author`, `state`, `source_branch`,
        `target_branch`, `base_sha`, `head_sha`, `web_url`, and `project_id`
        (GitLab only, needed for its discussions API).

    Raises:
        ForgeError: If the change request cannot be read.
    """
    cli_name = require_cli(forge_name)

    if forge_name == GITHUB:
        command = [
            cli_name, "pr", "view", number,
            "--json",
            "number,title,author,state,headRefName,baseRefName,headRefOid,url",
        ]
        if repo_slug is not None:
            command += ["--repo", repo_slug]
        raw = _run_json(command, cli_name)
        return {
            "number": str(raw["number"]),
            "title": raw["title"],
            "author": raw["author"]["login"],
            "state": raw["state"],
            "source_branch": raw["headRefName"],
            "target_branch": raw["baseRefName"],
            "base_sha": _merge_base(raw["baseRefName"], raw["headRefOid"]),
            "head_sha": raw["headRefOid"],
            "web_url": raw["url"],
            "project_id": None,
        }

    command = [cli_name, "mr", "view", number, "--output", "json"]
    if repo_slug is not None:
        command += ["--repo", repo_slug]
    raw = _run_json(command, cli_name)
    diff_refs = raw.get("diff_refs") or {}
    return {
        "number": str(raw["iid"]),
        "title": raw["title"],
        "author": raw["author"]["username"],
        "state": raw["state"],
        "source_branch": raw["source_branch"],
        "target_branch": raw["target_branch"],
        "base_sha": diff_refs.get("base_sha"),
        "head_sha": diff_refs.get("head_sha"),
        "web_url": raw.get("web_url"),
        "project_id": str(raw["project_id"]),
    }


def _run_json(command: list[str], cli_name: str) -> dict[str, Any]:
    """Run a CLI command that emits JSON and decode it.

    Args:
        command: The full command line.
        cli_name: CLI name, used only for error messages.

    Returns:
        The decoded JSON object.

    Raises:
        ForgeError: If the command fails or its output is not JSON.
    """
    try:
        completed_process = subprocess.run(
            command, capture_output=True, text=True, check=True
        )
    except FileNotFoundError as error:
        raise ForgeError(f"{cli_name} CLI not found") from error
    except subprocess.CalledProcessError as error:
        raise ForgeError(f"{' '.join(command)} failed: {error.stderr.strip()}") from error

    try:
        return json.loads(completed_process.stdout)
    except json.JSONDecodeError as error:
        raise ForgeError(f"could not parse {cli_name} output: {error}") from error


def _merge_base(target_branch: str, head_sha: str) -> str | None:
    """Resolve the merge base, which GitHub does not expose the way GitLab does.

    Args:
        target_branch: The branch the change request targets.
        head_sha: The change request head commit.

    Returns:
        The merge-base SHA, or None when it cannot be resolved locally.
    """
    try:
        completed_process = subprocess.run(
            ["git", "merge-base", f"origin/{target_branch}", head_sha],
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
    forge_name: str,
    new_line: int | None = None,
    old_line: int | None = None,
    repo_slug: str | None = None,
) -> str:
    """Post a comment pinned to a line of the diff, not a general note.

    The two forges model this very differently: GitHub takes a path plus a line
    and a side, while GitLab requires a full position object including a
    `line_code` derived from the file path. Both are handled here so callers only
    supply the line numbers they have.

    Args:
        number: PR number or MR IID.
        file_path: File path as it appears in the diff.
        body: Comment text.
        forge_name: Either `GITHUB` or `GITLAB`.
        new_line: New-side line number; set for an added or context line.
        old_line: Old-side line number; set for a removed or context line.
        repo_slug: Optional repository slug.

    Returns:
        The created note or comment id, as a string.

    Raises:
        ForgeError: If neither line number is supplied, or the request fails.
    """
    if new_line is None and old_line is None:
        raise ForgeError("at least one of new_line or old_line is required")

    change_request = view_change_request(number, forge_name, repo_slug)

    if forge_name == GITHUB:
        target_slug = repo_slug or _current_repo_slug(GITHUB)
        payload: dict[str, Any] = {
            "body": body,
            "commit_id": change_request["head_sha"],
            "path": file_path,
            "side": "RIGHT" if new_line is not None else "LEFT",
            "line": new_line if new_line is not None else old_line,
        }
        response = api(
            GITHUB,
            f"repos/{target_slug}/pulls/{number}/comments",
            method="POST",
            fields=payload,
        )
        return str(response["id"])

    line_code = compute_gitlab_line_code(file_path, old_line or 0, new_line or 0)
    line_endpoint = {
        "line_code": line_code,
        "type": _gitlab_line_type(old_line, new_line),
        "old_line": old_line,
        "new_line": new_line,
    }
    payload = {
        "body": body,
        "position": {
            "base_sha": change_request["base_sha"],
            "start_sha": change_request["base_sha"],
            "head_sha": change_request["head_sha"],
            "position_type": "text",
            "old_path": file_path,
            "new_path": file_path,
            "old_line": old_line,
            "new_line": new_line,
            "line_range": {"start": line_endpoint, "end": line_endpoint},
        },
    }
    response = api(
        GITLAB,
        f"projects/{change_request['project_id']}/merge_requests/{number}/discussions",
        method="POST",
        fields=payload,
    )
    return str(response["notes"][0]["id"])


def compute_gitlab_line_code(file_path: str, old_line: int, new_line: int) -> str:
    """Compute GitLab's diff `line_code`, which its discussions API requires.

    Args:
        file_path: File path as it appears in the diff.
        old_line: Old-side line number; 0 for an added line.
        new_line: New-side line number; 0 for a removed line.

    Returns:
        The line code `SHA1(file_path)_{old_line}_{new_line}`.
    """
    import hashlib

    file_path_hash = hashlib.sha1(file_path.encode()).hexdigest()
    return f"{file_path_hash}_{old_line}_{new_line}"


def _gitlab_line_type(old_line: int | None, new_line: int | None) -> str | None:
    """Map a line-number pair to GitLab's line type.

    Args:
        old_line: Old-side line number, or None.
        new_line: New-side line number, or None.

    Returns:
        `"new"`, `"old"`, or None for a context line.
    """
    if old_line is None:
        return "new"
    if new_line is None:
        return "old"
    return None


def list_review_threads(
    number: str, forge_name: str, repo_slug: str | None = None
) -> list[dict[str, Any]]:
    """List review threads on a change request, normalised across both forges.

    Args:
        number: PR number or MR IID.
        forge_name: Either `GITHUB` or `GITLAB`.
        repo_slug: Optional repository slug.

    Returns:
        A list of dicts with `thread_id`, `author`, `body`, `file_path`, `line`,
        and `resolved`.

    Raises:
        ForgeError: If the threads cannot be read.
    """
    if forge_name == GITHUB:
        target_slug = repo_slug or _current_repo_slug(GITHUB)
        comments = api(GITHUB, f"repos/{target_slug}/pulls/{number}/comments") or []
        return [
            {
                "thread_id": str(comment["id"]),
                "author": comment["user"]["login"],
                "body": comment["body"],
                "file_path": comment.get("path"),
                "line": comment.get("line") or comment.get("original_line"),
                "resolved": False,
            }
            for comment in comments
        ]

    change_request = view_change_request(number, GITLAB, repo_slug)
    discussions = api(
        GITLAB,
        f"projects/{change_request['project_id']}/merge_requests/{number}/discussions",
    ) or []
    threads = []
    for discussion in discussions:
        notes = discussion.get("notes") or []
        if not notes or notes[0].get("system"):
            continue
        first_note = notes[0]
        position = first_note.get("position") or {}
        threads.append(
            {
                "thread_id": discussion["id"],
                "author": first_note["author"]["username"],
                "body": first_note["body"],
                "file_path": position.get("new_path") or position.get("old_path"),
                "line": position.get("new_line") or position.get("old_line"),
                "resolved": bool(first_note.get("resolved")),
            }
        )
    return threads


def resolve_thread(
    number: str, thread_id: str, forge_name: str, repo_slug: str | None = None
) -> None:
    """Mark a review thread resolved.

    GitHub only exposes thread resolution through GraphQL, so the REST id from
    `list_review_threads` is mapped to its GraphQL node id first.

    Args:
        number: PR number or MR IID.
        thread_id: Thread id from `list_review_threads`.
        forge_name: Either `GITHUB` or `GITLAB`.
        repo_slug: Optional repository slug.

    Raises:
        ForgeError: If the thread cannot be resolved.
    """
    if forge_name == GITHUB:
        node_id = _github_thread_node_id(number, thread_id, repo_slug)
        mutation = (
            "mutation($threadId:ID!){resolveReviewThread(input:{threadId:$threadId})"
            "{thread{isResolved}}}"
        )
        subprocess.run(
            ["gh", "api", "graphql", "-f", f"query={mutation}", "-F", f"threadId={node_id}"],
            capture_output=True,
            text=True,
            check=True,
        )
        return

    change_request = view_change_request(number, GITLAB, repo_slug)
    api(
        GITLAB,
        f"projects/{change_request['project_id']}/merge_requests/{number}"
        f"/discussions/{thread_id}",
        method="PUT",
        fields={"resolved": True},
    )


def reply_to_thread(
    number: str,
    thread_id: str,
    body: str,
    forge_name: str,
    repo_slug: str | None = None,
) -> str:
    """Post a reply inside an existing review thread rather than as a new note.

    Args:
        number: PR number or MR IID.
        thread_id: Thread id from `list_review_threads`.
        body: Reply text.
        forge_name: Either `GITHUB` or `GITLAB`.
        repo_slug: Optional repository slug.

    Returns:
        The created note id, as a string.

    Raises:
        ForgeError: If the reply cannot be posted.
    """
    if forge_name == GITHUB:
        target_slug = repo_slug or _current_repo_slug(GITHUB)
        response = api(
            GITHUB,
            f"repos/{target_slug}/pulls/{number}/comments/{thread_id}/replies",
            method="POST",
            fields={"body": body},
        )
        return str(response["id"])

    change_request = view_change_request(number, GITLAB, repo_slug)
    response = api(
        GITLAB,
        f"projects/{change_request['project_id']}/merge_requests/{number}"
        f"/discussions/{thread_id}/notes",
        method="POST",
        fields={"body": body},
    )
    return str(response["id"])


def latest_ci_status(
    number: str, forge_name: str, repo_slug: str | None = None
) -> dict[str, Any]:
    """Report the CI outcome for a change request's head commit.

    Args:
        number: PR number or MR IID.
        forge_name: Either `GITHUB` or `GITLAB`.
        repo_slug: Optional repository slug.

    Returns:
        A dict with `state` (one of `success`, `failed`, `running`, `unknown`)
        and `web_url` when the forge provides one.

    Raises:
        ForgeError: If the status cannot be read.
    """
    change_request = view_change_request(number, forge_name, repo_slug)

    if forge_name == GITHUB:
        target_slug = repo_slug or _current_repo_slug(GITHUB)
        runs = api(
            GITHUB,
            f"repos/{target_slug}/commits/{change_request['head_sha']}/check-runs",
        ) or {}
        check_runs = runs.get("check_runs") or []
        if not check_runs:
            return {"state": "unknown", "web_url": change_request["web_url"]}
        if any(run["status"] != "completed" for run in check_runs):
            return {"state": "running", "web_url": change_request["web_url"]}
        failed = [
            run for run in check_runs
            if run["conclusion"] not in ("success", "neutral", "skipped")
        ]
        return {
            "state": "failed" if failed else "success",
            "web_url": (failed[0]["html_url"] if failed else change_request["web_url"]),
        }

    pipelines = api(
        GITLAB,
        f"projects/{change_request['project_id']}/merge_requests/{number}/pipelines",
    ) or []
    if not pipelines:
        return {"state": "unknown", "web_url": change_request["web_url"]}
    latest = pipelines[0]
    gitlab_state = latest.get("status")
    normalised = {
        "success": "success",
        "failed": "failed",
        "running": "running",
        "pending": "running",
        "created": "running",
    }.get(gitlab_state, "unknown")
    return {"state": normalised, "web_url": latest.get("web_url")}


def _github_thread_node_id(
    number: str, comment_id: str, repo_slug: str | None
) -> str:
    """Find the GraphQL thread node id that owns a REST review-comment id.

    Args:
        number: Pull request number.
        comment_id: REST comment id.
        repo_slug: Optional `owner/repo`.

    Returns:
        The GraphQL thread node id.

    Raises:
        ForgeError: If no thread contains the comment.
    """
    target_slug = repo_slug or _current_repo_slug(GITHUB)
    owner, _, repository = target_slug.partition("/")
    query = (
        "query($owner:String!,$repo:String!,$number:Int!){repository(owner:$owner,"
        "name:$repo){pullRequest(number:$number){reviewThreads(first:100){nodes{id "
        "comments(first:1){nodes{databaseId}}}}}}}"
    )
    completed_process = subprocess.run(
        [
            "gh", "api", "graphql",
            "-f", f"query={query}",
            "-F", f"owner={owner}",
            "-F", f"repo={repository}",
            "-F", f"number={number}",
        ],
        capture_output=True,
        text=True,
        check=True,
    )
    payload = json.loads(completed_process.stdout)
    threads = payload["data"]["repository"]["pullRequest"]["reviewThreads"]["nodes"]
    for thread in threads:
        comments = thread["comments"]["nodes"]
        if comments and str(comments[0]["databaseId"]) == str(comment_id):
            return thread["id"]
    raise ForgeError(f"no review thread found for comment {comment_id}")


def _current_repo_slug(forge_name: str) -> str:
    """Resolve the current repository's slug from its origin remote.

    Args:
        forge_name: Either `GITHUB` or `GITLAB`.

    Returns:
        `owner/repo` on GitHub, `group/subgroup/repo` on GitLab.

    Raises:
        ForgeError: If the remote cannot be parsed.
    """
    try:
        completed_process = subprocess.run(
            ["git", "remote", "get-url", "origin"],
            capture_output=True,
            text=True,
            check=True,
        )
    except (FileNotFoundError, subprocess.CalledProcessError) as error:
        raise ForgeError("could not read the origin remote") from error

    remote_url = completed_process.stdout.strip()
    remote_url = remote_url.removesuffix(".git")
    if remote_url.startswith("git@"):
        _, _, path = remote_url.partition(":")
        return path
    for host_marker in ("github.com/", "gitlab.com/"):
        if host_marker in remote_url:
            return remote_url.split(host_marker, 1)[1]
    raise ForgeError(f"could not derive a repo slug from {remote_url}")


def main() -> int:
    """Print the detected forge and current repo slug, as a smoke test.

    Returns:
        Process exit code: 0 on success, 1 on failure.
    """
    try:
        forge_name = detect_forge()
        print(f"forge={forge_name} cli={_FORGE_CLI[forge_name]} repo={_current_repo_slug(forge_name)}")
    except ForgeError as error:
        print(f"error: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())

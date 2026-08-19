#!/usr/bin/env python3
"""Read, inspect, and resolve the inline comments YOU left as a reviewer.

Reviewer-side plumbing for the verify-resolve-pr-comments skill. Works on GitHub
and GitLab through the shared `forge` helper.

Subcommands:
    list      Print your own inline threads as JSON — resolved AND unresolved,
              because an author may resolve a thread without actually fixing it,
              and that case still has to be verified.
    ci        Print the CI outcome for the change request's head commit.
    resolve   Mark one thread resolved.

Usage:
    pr_review_comments.py list    --pr <NUMBER> [--repo <slug>] [--forge <name>]
    pr_review_comments.py ci      --pr <NUMBER> [--repo <slug>]
    pr_review_comments.py resolve --pr <NUMBER> --thread <ID> [--repo <slug>]
"""

import argparse
import json
import os
import sys
from typing import Any

# Inside an installed plugin this is set for us; when the script is run straight
# from a clone, fall back to walking up to the plugin root.
_PLUGIN_ROOT = os.environ.get("CLAUDE_PLUGIN_ROOT") or os.path.abspath(
    os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..")
)
sys.path.insert(0, os.path.join(_PLUGIN_ROOT, "lib"))

import forge  # noqa: E402


def main() -> int:
    """Parse CLI arguments and dispatch to the requested subcommand.

    Returns:
        Process exit code: 0 on success, 1 on failure.
    """
    arguments = parse_arguments()

    try:
        forge_name = arguments.forge or forge.detect_forge()
        forge.require_cli(forge_name)

        if arguments.command == "list":
            return run_list(arguments.pr, forge_name, arguments.repo)
        if arguments.command == "ci":
            status = forge.latest_ci_status(arguments.pr, forge_name, arguments.repo)
            print(json.dumps(status, indent=2))
            return 0
        forge.resolve_thread(arguments.pr, arguments.thread, forge_name, arguments.repo)
        print(f"OK resolved thread={arguments.thread}")
        return 0
    except forge.ForgeError as error:
        print(f"error: {error}", file=sys.stderr)
        return 1


def run_list(number: str, forge_name: str, repo_slug: str | None) -> int:
    """Print the inline threads authored by the current user.

    Args:
        number: Pull request number or merge request IID.
        forge_name: Either `forge.GITHUB` or `forge.GITLAB`.
        repo_slug: Optional repository slug.

    Returns:
        Process exit code: 0 on success.
    """
    current_username = resolve_current_username(forge_name)
    threads = forge.list_review_threads(number, forge_name, repo_slug)
    mine = [
        thread
        for thread in threads
        if thread["author"] == current_username and thread["file_path"] is not None
    ]
    print(json.dumps({"me": current_username, "threads": mine}, indent=2))
    return 0


def resolve_current_username(forge_name: str) -> str:
    """Look up the authenticated user, to select only their own threads.

    Args:
        forge_name: Either `forge.GITHUB` or `forge.GITLAB`.

    Returns:
        The authenticated username.

    Raises:
        forge.ForgeError: If the user cannot be resolved.
    """
    if forge_name == forge.GITHUB:
        user: Any = forge.api(forge.GITHUB, "user")
        return user["login"]
    user = forge.api(forge.GITLAB, "user")
    return user["username"]


def parse_arguments() -> argparse.Namespace:
    """Define and parse the command-line arguments.

    Returns:
        The parsed argument namespace.
    """
    parser = argparse.ArgumentParser(
        description="Inspect and resolve your own inline review comments."
    )
    subparsers = parser.add_subparsers(dest="command", required=True)

    for command_name in ("list", "ci", "resolve"):
        subparser = subparsers.add_parser(command_name)
        subparser.add_argument("--pr", required=True, help="PR number or MR IID")
        subparser.add_argument("--repo", default=None, help="Repo slug")
        subparser.add_argument(
            "--forge", default=None, choices=[forge.GITHUB, forge.GITLAB]
        )
        if command_name == "resolve":
            subparser.add_argument("--thread", required=True, help="Thread id")

    return parser.parse_args()


if __name__ == "__main__":
    sys.exit(main())

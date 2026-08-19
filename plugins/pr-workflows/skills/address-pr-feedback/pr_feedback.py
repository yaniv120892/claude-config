#!/usr/bin/env python3
"""Triage, reply to, and resolve reviewer feedback on a change request you authored.

Author-side plumbing for the address-pr-feedback skill. Works on GitHub and
GitLab through the shared `forge` helper; the forge is detected from the origin
remote unless `--forge` overrides it.

Subcommands:
    list      Print the incoming reviewer threads as JSON — every thread whose
              first note is by someone other than you. Resolved threads are
              included, because a reviewer may resolve a thread themselves.
    reply     Post a threaded reply into one thread.
    resolve   Mark one thread resolved.

Usage:
    pr_feedback.py list    --pr <NUMBER> [--repo <slug>] [--forge <name>]
    pr_feedback.py reply   --pr <NUMBER> --thread <ID> --body <text> [--repo <slug>]
    pr_feedback.py resolve --pr <NUMBER> --thread <ID> [--repo <slug>]
"""

import argparse
import json
import os
import subprocess
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
        if arguments.command == "reply":
            note_id = forge.reply_to_thread(
                arguments.pr,
                arguments.thread,
                read_reply_body(arguments),
                forge_name,
                arguments.repo,
            )
            print(f"OK replied note_id={note_id} thread={arguments.thread}")
            return 0
        forge.resolve_thread(arguments.pr, arguments.thread, forge_name, arguments.repo)
        print(f"OK resolved thread={arguments.thread}")
        return 0
    except forge.ForgeError as error:
        print(f"error: {error}", file=sys.stderr)
        return 1


def run_list(number: str, forge_name: str, repo_slug: str | None) -> int:
    """Print the reviewer threads the author still needs to work through.

    Args:
        number: Pull request number or merge request IID.
        forge_name: Either `forge.GITHUB` or `forge.GITLAB`.
        repo_slug: Optional repository slug.

    Returns:
        Process exit code: 0 on success.
    """
    current_username = resolve_current_username(forge_name)
    threads = forge.list_review_threads(number, forge_name, repo_slug)
    incoming = [
        thread for thread in threads if thread["author"] != current_username
    ]
    print(json.dumps({"me": current_username, "threads": incoming}, indent=2))
    return 0


def resolve_current_username(forge_name: str) -> str:
    """Look up the authenticated user, so their own threads can be filtered out.

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


def read_reply_body(arguments: argparse.Namespace) -> str:
    """Resolve the reply text from either the inline flag or a file.

    A reply is usually multi-line markdown, which is awkward to pass as a shell
    argument, so `--body-file` is the preferred form.

    Args:
        arguments: The parsed argument namespace.

    Returns:
        The reply body.

    Raises:
        forge.ForgeError: If neither source was supplied, or the file is unreadable.
    """
    if arguments.body_file is not None:
        try:
            with open(arguments.body_file, encoding="utf-8") as body_file:
                return body_file.read()
        except OSError as error:
            raise forge.ForgeError(f"could not read {arguments.body_file}: {error}") from error
    if arguments.body is not None:
        return arguments.body
    raise forge.ForgeError("one of --body or --body-file is required")


def parse_arguments() -> argparse.Namespace:
    """Define and parse the command-line arguments.

    Returns:
        The parsed argument namespace.
    """
    parser = argparse.ArgumentParser(
        description="Triage and answer reviewer feedback on your change request."
    )
    subparsers = parser.add_subparsers(dest="command", required=True)

    for command_name in ("list", "reply", "resolve"):
        subparser = subparsers.add_parser(command_name)
        subparser.add_argument("--pr", required=True, help="PR number or MR IID")
        subparser.add_argument("--repo", default=None, help="Repo slug")
        subparser.add_argument(
            "--forge", default=None, choices=[forge.GITHUB, forge.GITLAB]
        )
        if command_name in ("reply", "resolve"):
            subparser.add_argument("--thread", required=True, help="Thread id")
        if command_name == "reply":
            subparser.add_argument("--body", default=None, help="Reply text")
            subparser.add_argument(
                "--body-file", default=None, help="File holding the reply text"
            )

    return parser.parse_args()


if __name__ == "__main__":
    sys.exit(main())

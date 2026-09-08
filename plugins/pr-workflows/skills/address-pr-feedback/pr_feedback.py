#!/usr/bin/env python3
"""Triage, reply to, and resolve reviewer feedback on a pull request you authored.

Author-side plumbing for the address-pr-feedback skill. Every call goes
through the shared `github` helper, so the repository slug defaults to the
origin remote unless `--repo` overrides it.

Subcommands:
    list      Print the incoming reviewer threads as JSON — every thread whose
              first note is by someone other than you. Resolved threads are
              included, because a reviewer may resolve a thread themselves.
    reply     Post a threaded reply into one thread.
    resolve   Mark one thread resolved.

Usage:
    pr_feedback.py list    --pr <NUMBER> [--repo <slug>]
    pr_feedback.py reply   --pr <NUMBER> --thread <ID> --body <text> [--repo <slug>]
    pr_feedback.py resolve --pr <NUMBER> --thread <ID> [--repo <slug>]
"""

import argparse
import json
import os
import sys

# Inside an installed plugin this is set for us; when the script is run straight
# from a clone, fall back to walking up to the plugin root.
_PLUGIN_ROOT = os.environ.get("CLAUDE_PLUGIN_ROOT") or os.path.abspath(
    os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..")
)
sys.path.insert(0, os.path.join(_PLUGIN_ROOT, "lib"))

import github  # noqa: E402


def main() -> int:
    """Parse CLI arguments and dispatch to the requested subcommand.

    Returns:
        Process exit code: 0 on success, 1 on failure.
    """
    arguments = parse_arguments()

    try:
        github.require_cli()

        if arguments.command == "list":
            return run_list(arguments.pr, arguments.repo)
        if arguments.command == "reply":
            comment_id = github.reply_to_thread(
                arguments.pr,
                arguments.thread,
                read_reply_body(arguments),
                arguments.repo,
            )
            print(f"OK replied comment_id={comment_id} thread={arguments.thread}")
            return 0
        github.resolve_thread(arguments.pr, arguments.thread, arguments.repo)
        print(f"OK resolved thread={arguments.thread}")
        return 0
    except github.GitHubError as error:
        print(f"error: {error}", file=sys.stderr)
        return 1


def run_list(number: str, repo_slug: str | None) -> int:
    """Print the reviewer threads the author still needs to work through.

    Args:
        number: Pull request number.
        repo_slug: Optional repository slug.

    Returns:
        Process exit code: 0 on success.
    """
    current_username = github.current_username()
    threads = github.list_review_threads(number, repo_slug)
    incoming = [
        thread for thread in threads if thread["author"] != current_username
    ]
    print(json.dumps({"me": current_username, "threads": incoming}, indent=2))
    return 0


def read_reply_body(arguments: argparse.Namespace) -> str:
    """Resolve the reply text from either the inline flag or a file.

    A reply is usually multi-line markdown, which is awkward to pass as a shell
    argument, so `--body-file` is the preferred form.

    Args:
        arguments: The parsed argument namespace.

    Returns:
        The reply body.

    Raises:
        github.GitHubError: If neither source was supplied, or the file is unreadable.
    """
    if arguments.body_file is not None:
        try:
            with open(arguments.body_file, encoding="utf-8") as body_file:
                return body_file.read()
        except OSError as error:
            raise github.GitHubError(
                f"could not read {arguments.body_file}: {error}"
            ) from error
    if arguments.body is not None:
        return arguments.body
    raise github.GitHubError("one of --body or --body-file is required")


def parse_arguments() -> argparse.Namespace:
    """Define and parse the command-line arguments.

    Returns:
        The parsed argument namespace.
    """
    parser = argparse.ArgumentParser(
        description="Triage and answer reviewer feedback on your pull request."
    )
    subparsers = parser.add_subparsers(dest="command", required=True)

    for command_name in ("list", "reply", "resolve"):
        subparser = subparsers.add_parser(command_name)
        github.add_pull_request_arguments(subparser)
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

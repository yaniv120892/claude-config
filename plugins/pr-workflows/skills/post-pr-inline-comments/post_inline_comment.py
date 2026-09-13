#!/usr/bin/env python3
"""Post a single inline diff comment on a pull request.

The comment payload is built by the shared `github` helper rather than
assembled by hand here.

Usage:
    post_inline_comment.py --pr <NUMBER> --file <path> --body <text>
        (--new-line <N> and/or --old-line <N>) [--repo <slug>] [--head-sha <sha>]

An added line uses --new-line only. A removed line uses --old-line only. A
context (unchanged) line takes both.
"""

import argparse
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
    """Parse CLI arguments and post the inline comment.

    Returns:
        Process exit code: 0 on success, 1 on failure.
    """
    arguments = parse_arguments()

    try:
        github.require_cli()
        comment_id = github.post_inline_comment(
            number=arguments.pr,
            file_path=arguments.file,
            body=arguments.body,
            new_line=arguments.new_line,
            old_line=arguments.old_line,
            repo_slug=arguments.repo,
            head_sha=arguments.head_sha,
        )
    except github.GitHubError as error:
        print(f"error: {error}", file=sys.stderr)
        return 1

    print(
        f"OK comment_id={comment_id} file={arguments.file} "
        f"old_line={arguments.old_line} new_line={arguments.new_line}"
    )
    return 0


def parse_arguments() -> argparse.Namespace:
    """Define and parse the command-line arguments.

    Returns:
        The parsed argument namespace.
    """
    parser = argparse.ArgumentParser(
        description="Post an inline diff comment on a pull request."
    )
    github.add_pull_request_arguments(parser)
    parser.add_argument(
        "--file", required=True, help="File path as it appears in the diff"
    )
    parser.add_argument(
        "--new-line", type=int, default=None, help="New-side line number"
    )
    parser.add_argument(
        "--old-line", type=int, default=None, help="Old-side line number"
    )
    parser.add_argument("--body", required=True, help="Comment text")
    parser.add_argument(
        "--head-sha",
        default=None,
        help="Head commit to pin against; skips a `gh pr view` per comment",
    )
    return parser.parse_args()


if __name__ == "__main__":
    sys.exit(main())

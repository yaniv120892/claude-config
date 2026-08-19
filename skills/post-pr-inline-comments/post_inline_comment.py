#!/usr/bin/env python3
"""Post a single inline diff comment on a pull or merge request.

Works on GitHub and GitLab: the forge is detected from the repository's origin
remote, and the position payload each forge requires is built by the shared
`forge` helper rather than assembled by hand here.

Usage:
    post_inline_comment.py --pr <NUMBER> --file <path> --body <text>
        (--new-line <N> and/or --old-line <N>) [--repo <slug>] [--forge <name>]

An added line uses --new-line only. A removed line uses --old-line only. A
context (unchanged) line takes both.
"""

import argparse
import os
import sys

sys.path.insert(
    0,
    os.path.expanduser(os.environ.get("CLAUDE_CONFIG_DIR", "~/.claude") + "/lib"),
)

import forge  # noqa: E402


def main() -> int:
    """Parse CLI arguments and post the inline comment.

    Returns:
        Process exit code: 0 on success, 1 on failure.
    """
    arguments = parse_arguments()

    if arguments.new_line is None and arguments.old_line is None:
        print("error: at least one of --new-line or --old-line is required", file=sys.stderr)
        return 1

    try:
        forge_name = arguments.forge or forge.detect_forge()
        forge.require_cli(forge_name)
        note_id = forge.post_inline_comment(
            number=arguments.pr,
            file_path=arguments.file,
            body=arguments.body,
            forge_name=forge_name,
            new_line=arguments.new_line,
            old_line=arguments.old_line,
            repo_slug=arguments.repo,
        )
    except forge.ForgeError as error:
        print(f"error: {error}", file=sys.stderr)
        return 1

    print(
        f"OK forge={forge_name} note_id={note_id} file={arguments.file} "
        f"old_line={arguments.old_line} new_line={arguments.new_line}"
    )
    return 0


def parse_arguments() -> argparse.Namespace:
    """Define and parse the command-line arguments.

    Returns:
        The parsed argument namespace.
    """
    parser = argparse.ArgumentParser(
        description="Post an inline diff comment on a pull or merge request."
    )
    parser.add_argument("--pr", required=True, help="Pull request number or merge request IID")
    parser.add_argument("--file", required=True, help="File path as it appears in the diff")
    parser.add_argument("--new-line", type=int, default=None, help="New-side line number")
    parser.add_argument("--old-line", type=int, default=None, help="Old-side line number")
    parser.add_argument("--body", required=True, help="Comment text")
    parser.add_argument("--repo", default=None, help="Repo slug; defaults to the origin remote")
    parser.add_argument(
        "--forge",
        default=None,
        choices=[forge.GITHUB, forge.GITLAB],
        help="Override forge detection",
    )
    return parser.parse_args()


if __name__ == "__main__":
    sys.exit(main())

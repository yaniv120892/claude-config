---
name: post-pr-inline-comments
disable-model-invocation: true
description: Use when posting review comments on a pull request — during code review, after analysis, or when asked to add comments to a PR. Always post as inline diff comments pinned to specific file lines, never as general notes.
---

# Post Review Comments as Inline Diff Notes

Always post as inline notes pinned to a file + line, never as a general comment.
A general note forces the reader to hunt for what it refers to; an inline note
lands next to the code.

The payload is easy to get wrong by hand — it needs the head `commit_id` and a
`side` alongside the path and line. Use `post_inline_comment.py`, which reads
both for you.

## Step 1 — Gather position data

```bash
../creating-prs/pr-meta.sh <NUMBER> [--repo <slug>]
```

It prints `BASE_SHA`, `HEAD_SHA`, and the branch names.

## Step 2 — Identify exact line numbers

Read the file at the pull request's head so line numbers match what the
reviewer sees.

```bash
gh api "repos/<slug>/contents/<PATH>?ref=<HEAD_SHA>" --jq '.content' | base64 -d | cat -n
```

## Step 3 — Decide which lines to comment on and what to write

This is the judgment part — the script handles the plumbing, you decide the
substance:

- **Which line** — anchor each comment to the precise file + line of the concern.
  Prefer added lines (`+` in the diff). If the natural anchor is a context line,
  attach to the nearest added line in the same hunk and reference the context in
  the body.
- **Line side** — an added line uses `--new-line` only. A removed line uses
  `--old-line` only. A context (unchanged) line takes both.
- **What to write** — a self-contained note: the issue, why it matters, and the
  suggested fix. Specific and actionable.

## Step 4 — Post the inline comment

```bash
python3 post_inline_comment.py \
  --pr <NUMBER> \
  --file <path/as/in/diff> \
  --new-line <N> \
  --body "Comment text here" \
  [--old-line <N>] \
  [--repo <slug>] \
  [--head-sha <sha>]
```

Run it once per comment. It prints `OK comment_id=<id> ...` on success.

Pass `--head-sha` (the `HEAD_SHA` from Step 1) when posting more than one
comment. Without it the script re-runs `gh pr view` for every single comment.

## Step 5 — General notes (non-code context)

For a comment not tied to a line — asking the author to update the description,
say — use a general note:

```bash
gh pr comment <NUMBER> --body "Your comment here"
```

## Common Mistakes

| Mistake | Fix |
|---|---|
| Posting everything as a general note | Pin it to the line with `post_inline_comment.py` |
| Forgetting `commit_id` | The script reads the head SHA for you |
| Wrong line side | Added → `--new-line`; removed → `--old-line`; context → both |
| Commenting on a context line with only one side | Context lines need both numbers; check the diff hunk |
| Anchoring to a context line when an added line exists | Use the nearest added line and reference the context in the body |

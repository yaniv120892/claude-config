---
name: post-pr-inline-comments
disable-model-invocation: true
description: Use when posting review comments on a pull or merge request — during code review, after analysis, or when asked to add comments to a PR/MR. Always post as inline diff comments pinned to specific file lines, never as general notes. Works on GitHub and GitLab.
---

# Post Review Comments as Inline Diff Notes

Always post as inline notes pinned to a file + line, never as a general comment.
A general note forces the reader to hunt for what it refers to; an inline note
lands next to the code.

Both forges make hand-assembling the payload easy to get wrong — GitHub needs the
head `commit_id` and a `side`, GitLab needs a full `position` object with a
computed `line_code`, and `glab api --field` silently degrades a nested
`position` into a general note. Use `post_inline_comment.py`, which handles both.

## Step 1 — Gather position data

```bash
../creating-prs/pr-meta.sh <NUMBER> [--repo <slug>]
```

It prints `FORGE`, `PROJECT_ID` (GitLab only), `BASE_SHA`, `HEAD_SHA`, and the
branch names.

## Step 2 — Identify exact line numbers

Read the file at the change request's head so line numbers match what the
reviewer sees.

**GitHub:**

```bash
gh api "repos/{OWNER}/{REPO}/contents/{PATH}?ref={HEAD_SHA}" \
  --jq '.content' | base64 -d | cat -n
```

**GitLab** (URL-encode the path — `/` becomes `%2F`):

```bash
glab api "projects/{PROJECT_ID}/repository/files/{URL_ENCODED_PATH}?ref={HEAD_SHA}" \
  | python3 -c "import sys,json,base64; d=json.load(sys.stdin); print(base64.b64decode(d['content']).decode())" \
  | cat -n
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
  [--forge github|gitlab]
```

Run it once per comment. It prints `OK forge=<name> note_id=<id> ...` on success.

## Step 5 — General notes (non-code context)

For a comment not tied to a line — asking the author to update the description,
say — use a general note:

```bash
gh pr comment <NUMBER> --body "Your comment here"          # GitHub
glab mr note <IID> --message "Your comment here"           # GitLab
```

## Common Mistakes

| Mistake | Fix |
|---|---|
| Posting everything as a general note | Pin it to the line with `post_inline_comment.py` |
| Hand-assembling the GitLab `position` object | `glab api --field` mangles nested objects — use the script |
| Forgetting `commit_id` on GitHub | The script reads the head SHA for you |
| Wrong line side | Added → `--new-line`; removed → `--old-line`; context → both |
| Commenting on a context line with only one side | Context lines need both numbers; check the diff hunk |
| Anchoring to a context line when an added line exists | Use the nearest added line and reference the context in the body |

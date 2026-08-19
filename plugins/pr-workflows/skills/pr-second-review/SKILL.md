---
name: pr-second-review
description: Use when a developer says they fixed review comments and wants a second-pass check. Trigger on "check if fixed", "they fixed it", "second review", or any follow-up after review comments were posted. Works on GitHub and GitLab. Shows ALL comments I posted (including already-resolved ones — developers sometimes self-resolve without fixing), verifies each against the latest diff, resolves confirmed fixes, approves, and optionally posts to Slack.
---

# Second Review — verify fixes & approve

## Delegate to a Sonnet subagent

**Do not run this verification inline.** Checking each comment against explicit fixed/not-fixed criteria is a well-specified task that doesn't need this session's model tier or its accumulated context.

**Anti-recursion guard:** if your own task prompt already identifies you as the dispatched pr-second-review subagent, skip this section and go straight to **Step 0** below.

Otherwise, spawn a subagent to run the full flow:

```
Agent({
  description: "Second-pass review",
  model: "sonnet",
  run_in_background: false,
  prompt: "You are the pr-second-review subagent. Invoke the pr-second-review skill
    yourself and follow it directly end-to-end — you are the dispatched subagent, so
    do not delegate further. Change request: <number/URL>. Repo: <slug>. Return the
    Step 4 status table, what you resolved/approved, and whether the user should be
    asked about a Slack reply."
})
```

Relay the subagent's status table and outcome to the user, and handle the Slack-reply ask (Step 7) yourself if the subagent reports it's needed.

## Step 0 — Parse the change request reference

Accept a full PR/MR URL, or a bare number plus `--repo`. Detect the forge from the URL host or the origin remote; see `${CLAUDE_PLUGIN_ROOT}/references/forge-cli.md`.

From `https://github.com/owner/repo/pull/437` or `https://gitlab.com/group/subgroup/repo/-/merge_requests/437`:
- repo = `group/subgroup/repo`
- number = `437`

## Step 1 — Fetch metadata and all review threads in parallel

```bash
# metadata (forge-agnostic)
../creating-prs/pr-meta.sh <NUMBER> --repo <slug>

# or directly — GitLab shown; use `gh pr view --json ...` on GitHub
glab mr view <IID> --repo <repo> --output json \
  | python3 -c "
import sys, json; d = json.load(sys.stdin)
print('PROJECT_ID:', d['project_id'])
print('HEAD_SHA:  ', d['diff_refs']['head_sha'])
"

# All discussions
# my own inline threads, normalised across both forges
python3 ../verify-resolve-pr-comments/pr_review_comments.py list --pr <NUMBER> --repo <slug>

# Latest diff
gh pr diff <NUMBER>   # GitHub
glab mr diff <IID> --repo <repo>   # GitLab
```

## Step 2 — Extract ALL comments I posted

The `list` command above already returns exactly this: every inline thread whose
first note is yours, resolved or not, with the authenticated user resolved for
you. Do not re-parse raw discussion JSON — the shapes differ per forge and the
script has already normalised them.

Each thread carries `thread_id`, `body`, `file_path`, `line`, `resolved`, and
`resolved_by`. Triage on the last two:

| `resolved` | `resolved_by` | Read it as |
| --- | --- | --- |
| `false` | `null` | 🔴 open — verify against the diff |
| `true` | you | ✅ you already closed it |
| `true` | someone else | ⚠️ **suspicious** — the author may have self-closed it without fixing the code. Always verify these against the diff. |

**Forge limitation:** GitHub's REST API exposes neither flag, so on GitHub every
thread comes back `resolved: false, resolved_by: null` and the ⚠️ case cannot be
detected — verify every thread against the diff there rather than trusting the
resolved state.

## Step 3 — Verify each comment against the latest diff

For every comment I posted (resolved or not), read the relevant section of the new diff or the updated file at HEAD and decide:

- **Fixed** — the concern is gone in the new code (name changed, test added, type corrected, duplication removed, etc.)
- **Not fixed** — the code still has the problem I flagged.
- **Follow-up / N/A** — the comment was explicitly a suggestion for a future change; treat as fixed.

To read a file at HEAD:

```bash
# GitHub: gh api "repos/<slug>/contents/<PATH>?ref=<HEAD_SHA>" --jq .content | base64 -d
glab api "projects/<PROJECT_ID>/repository/files/<URL_ENCODED_PATH>?ref=<HEAD_SHA>" \
  | python3 -c "import sys,json,base64; d=json.load(sys.stdin); print(base64.b64decode(d['content']).decode())" \
  | cat -n
```

URL-encode path: replace `/` with `%2F`.

## Step 4 — Present a status table to the user

| # | Comment (truncated) | Resolved? | Actually fixed? |
|---|---------------------|-----------|-----------------|
| 1 | Missing `public` on… | ✅ by me | ✅ Yes |
| 2 | Counter duplication… | ⚠️ by developer | ✅ Yes |
| 3 | Misleading name… | 🔴 open | ✅ Yes |
| 4 | Test missing assert… | ⚠️ by developer | ❌ No |

If any comment is **not actually fixed** — regardless of who resolved it — stop here and report clearly. Do not approve until all are addressed.

## Step 5 — Resolve all unresolved-by-me discussions that are confirmed fixed

For each of my discussions where `resolvable: true`, `resolved_by_me: false`, and the concern is confirmed fixed:

```bash
python3 ../verify-resolve-pr-comments/pr_review_comments.py resolve --pr <NUMBER> --thread <ID>
# or, GitLab REST directly:
glab api --method PUT \
  "projects/<PROJECT_ID>/merge_requests/<MR_IID>/discussions/<DISCUSSION_ID>" \
  --field "resolved=true"
```

Run in parallel. Skip discussions already resolved by me.

## Step 6 — Approve

```bash
gh pr review <NUMBER> --approve      # GitHub
glab mr approve <IID> --repo <repo>  # GitLab
```

## Step 7 — Offer to post to Slack

After approving, ask the user:

> "Done — approved. Want me to reply in a Slack thread? If so, drop the thread URL."

When the user provides a URL like `https://<workspace>.slack.com/archives/C04AY4FNUUB/p1782136493804559`:
- `channel_id` = `C04AY4FNUUB`
- `thread_ts` = insert `.` before the last 6 digits → `1782136493.804559`

Use the Slack MCP `slack_send_message` tool with `channel_id`, `thread_ts`, and `message: "approved"`.

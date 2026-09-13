---
name: pr-review
description: Use when asked to review one or more pull requests, given PR numbers or URLs to review, or asked whether a PR is safe to merge. Also use when a review must check that documentation still matches the code.
---

# Pull Request Review

Reviews a batch of pull requests. One subagent per PR, all in parallel. Every
PR gets a code review and a documentation-drift check. Findings merge into one
report, you approve once, everything posts.

## Step 1 — Require explicit targets

Collect every PR number or URL from the request. Accept several.

**If none were given, STOP and ask which PRs.** Never fall back to the current
branch — it is routinely a different ticket, stale, or stacked under the change
actually being reviewed.

Resolve each target to `owner/repo` + number before dispatching.

## Step 2 — Dispatch one subagent per PR, in parallel

Send all `Agent` calls in a **single message** so they run concurrently.

Substitute the real absolute paths into the prompt — a subagent cannot expand
`${CLAUDE_PLUGIN_ROOT}`.

```
Agent({
  description: "Review PR <n>",
  model: "sonnet",
  subagent_type: "general-purpose",
  prompt: "Review pull request <owner/repo>#<n>.

    Read these first, in order:
      <PLUGIN_ROOT>/skills/pr-review/references/rubric.md
      <PLUGIN_ROOT>/skills/pr-review/references/docs-alignment.md
    Then read whichever of these match the stack in the diff, and skip the rest:
      <PLUGIN_ROOT>/skills/reviewing-pr-code/references/express-backend-review.md
      <PLUGIN_ROOT>/skills/reviewing-pr-code/references/nextjs-frontend-review.md
      <PLUGIN_ROOT>/skills/reviewing-pr-code/references/code-smells.md

    Follow rubric.md exactly. Do not delegate further. Do not post anything —
    the caller posts after the user approves.

    Budget: at most ~25 tool calls. Fetch the diff ONCE and work from it. Read at
    most 3 surrounding source files and do at most 2 Notion searches. If you are
    running long, return what you have rather than continuing.

    Return the sections rubric.md's output contract specifies and nothing else."
})
```

Resolve the head SHA and changed-file list yourself before dispatching, and put
them in the prompt — it saves the agent two calls and makes a stall easier to
retry:

```bash
gh pr view <n> --repo <slug> --json headRefOid,files \
  --jq '.headRefOid, (.files | length)'
```

Do not review inline yourself. The orchestrator never loads the rubric; that is
the point of keeping it in `references/`.

**If an agent stalls or fails**, re-dispatch only that PR with the same prompt.
The others' results still stand — never re-run the whole batch.

## Step 3 — Merge into one report

```markdown
## Review — <N> pull requests

| PR | Severity | file:line | Issue | Fix |
|---|---|---|---|---|
```

One table, sorted HIGH → MEDIUM → LOW across every PR, so the worst thing in
the batch is the first row regardless of which PR it came from. Then:

- **Rule violations** — a separate table. A style violation is not a bug, and
  mixing them buries the bugs.
- **Docs alignment** — per PR: Notion page, what the diff contradicts, one line
  on what to update.
- **CI** — per PR: which jobs, which commit, green or not. Say plainly when you
  could not verify.
- **Verdict** — one line per PR.

Report faithfully. If a subagent could not verify something, carry that through
to the report rather than smoothing it over.

## Step 4 — One approval for the batch

End with: `Post <N> comments across <M> PRs? (y/n)`

Wait. Nothing posts before an explicit yes.

## Step 5 — Post

On yes, use the **post-pr-inline-comments** skill for every finding, pinned to
its file and line. Docs-alignment findings post as a general note on the PR.

Every comment obeys the comment contract in `references/rubric.md`: two
sentences, then a ` ```suggestion ` block where the fix is code.

## Gotchas

- `gh pr review --approve` cannot approve your own PR.
- Docs alignment never writes to Notion. It reports drift; you decide.

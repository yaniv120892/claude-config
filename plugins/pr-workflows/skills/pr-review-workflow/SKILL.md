---
name: pr-review-workflow
disable-model-invocation: true
description: Review a pull or merge request. Use when the user asks to review a PR/MR, or is given a change request URL or number to review. Detects GitHub or GitLab and uses the matching CLI.
---

# Pull / Merge Request Review Workflow

## Delegate the analysis to a Sonnet subagent

**Do not fetch and analyze the diff inline.** Steps 1–4 (fetch, read files, analyze, structure the review) are a well-specified checklist task that doesn't need this session's model tier or its accumulated context.

**Anti-recursion guard:** if your own task prompt already identifies you as the dispatched pr-review-workflow subagent, skip this section and go straight to **Step 1** below.

Otherwise, spawn a subagent to run Steps 1–4 and return the formatted review:

```
Agent({
  description: "Analyze change request",
  model: "sonnet",
  run_in_background: false,
  prompt: "You are the pr-review-workflow subagent. Invoke the pr-review-workflow skill
    yourself and follow it directly through Step 4 only — you are the dispatched
    subagent, so do not delegate further, and do NOT post anything (Step 5 is handled
    by the caller after user approval). Change request: <number/URL>. Repo: <slug>.
    Return the exact Step 4 formatted review output, nothing else."
})
```

Present the returned review to the user exactly as formatted, then continue to **Step 5** yourself once they approve — posting is a side-effecting action and stays in this conversation.

## Step 1 — Fetch metadata and diff

Run both in parallel:

```bash
# GitHub
gh pr view <NUMBER> --repo <owner/repo>
gh pr diff <NUMBER> --repo <owner/repo>

# GitLab
glab mr view <IID> --repo <group/subgroup/repo>
glab mr diff <IID> --repo <group/subgroup/repo>
```

If no number is provided, run `gh pr list` / `glab mr list` to show what is open.

## Step 2 — Read changed files for context

For each modified file, read the relevant sections from the local worktree to understand:
- Types and interfaces the change depends on
- Sibling patterns (e.g., how other fields in the same component are implemented)
- Schema/DTO conventions established elsewhere in the file

## Step 3 — Analyse the changes

Review for:

- **Correctness** — logic bugs, edge cases, null/undefined handling
- **Fail fast, don't propagate** — invalid/empty/unexpected state must be guarded at the boundary and thrown immediately, not passed downstream to fail later somewhere confusing or be silently swallowed. Flag catch-and-continue, sentinel/`undefined`/`null` returns that defer a failure, and `?? <fallback>` that masks a state which should actually throw.
- **Assertion helpers over inline throw-guards** — when a check is `if (<condition>) { throw new Error(...) }` (or `if (!x) { throw }`), prefer an `assert…`-style helper (`assertExists(x)`, `assertSomething(cond, msg)`) that encapsulates the condition + throw and narrows the type. Flag raw inline throw-guards a shared assertion helper would express more clearly.
- **Accessibility** — semantic HTML, aria labels on interactive elements, label linkage
- **Consistency** — naming, component patterns, typography variants match sibling usage
- **Type safety** — schema and DTO alignment, nullable vs optional handling
- **Input validation** — missing constraints (maxLength, min/max) when helper text implies limits
- **CHANGELOG noise** — unrelated formatting changes that should be reverted
- **Test coverage** — only flag if the tab/component already has tests; otherwise soft note

## Step 4 — Structure the review

Present findings to the user before posting, using this exact format:

```
## Code Review — <number>: <title>

### Overview
<1–2 sentence summary of what the change does>

### Comments

**Comment 1:** <title>
<description of the issue, file/line context, and what to fix — with code snippet if applicable>

**Comment 2:** <title>
<description of the issue, file/line context, and what to fix — with code snippet if applicable>

...

### Summary
<overall verdict — what must change vs what's optional>
```

Rules for comments:
- Always numbered sequentially: **Comment 1:**, **Comment 2:**, etc.
- Each is self-contained: file context + issue + suggested fix
- Actionable: the author knows exactly what to change
- When a concern spans multiple change requests, number it once under a "Cross-cutting" header before the per-request sections, still using the same numbering sequence

**CRITICAL — DO NOT POST until the user approves.**
End with: "Review ready. Waiting for your approval before posting to <number>."

## Step 5 — Post approved comments

When the user approves, use the **post-pr-inline-comments** skill to post each comment as an inline diff note pinned to the exact file and line.

- Comments tied to a specific file/line → inline diff note
- Comments about the description or cross-cutting concerns → a general note

## Notes

- Detect the forge from the origin remote and use the matching CLI throughout; see `${CLAUDE_PLUGIN_ROOT}/references/forge-cli.md`
- Repo slug format: `owner/repo` on GitHub, `group/subgroup/repo` on GitLab
- Do not approve or request changes (`gh pr review`, `glab mr approve`) unless explicitly asked

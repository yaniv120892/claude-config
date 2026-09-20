---
name: writing-pr-description
description: Use when a pull or merge request body is being written or rewritten — opening one with `gh pr create`, editing one with `gh pr edit`, a PR sitting with an empty or auto-generated body, or a reviewer asking for more context in the description. Fills in the repo's own PR template when there is one; otherwise a plain-language Motivation, a file-anchored Implementation, a Proof of Work from running the code before and after, and Verify-on-dev acceptance criteria, with shorter forms for docs-only, config-only, and package-bump changes.
---

# Writing PR Descriptions

## Overview

A PR description is the primary context reviewers and future readers have for understanding a change. It must answer four questions, each for a different reader: **Why was this needed?** — in plain words, for the product person. **Which files changed, and what does each do for the feature?** — for the reviewer. **What happened when you ran it, before and after?** — for anyone who has to trust it. **What gets checked once it is deployed?** — for whoever is on the other side of the merge.

Those four are the default shape. **A PR template already in the repo replaces it** — see **The repo's own template wins**. The last two exist only when the change *does* something at runtime; **Pick the form first** decides which sections a given diff gets.

**Announce at start:** "I'm using the writing-pr-description skill."

## Delegate to a Sonnet subagent

**Do not draft the description inline in the current conversation.** Writing a PR description is a formatting/synthesis task — it doesn't need this session's model tier, and drafting it inline means it inherits the whole session's accumulated context (large diffs, prior tool output) at whatever cache/token cost that carries, often on a more expensive model than the task needs.

**Anti-recursion guard:** if your own task prompt already identifies you as the dispatched writing-pr-description subagent, skip this section and start at **Core principle** — do not delegate again.

Otherwise, immediately spawn a subagent instead of doing the work yourself:

```
Agent({
  description: "Write PR description",
  model: "sonnet",
  run_in_background: false,
  prompt: "You are the writing-pr-description subagent for <repo absolute path>.
    Invoke the writing-pr-description skill yourself and follow it directly —
    you are the dispatched subagent, so do not delegate further.
    Ticket: <ticket ID if known>. Base branch: <base branch, e.g. origin/main>.
    You have Bash: gather Proof of Work by running the code yourself, on this
    branch and on the base branch. Apply the finished description with
    `gh pr edit --body` (or `gh pr create --body` if the PR does not exist yet)."
})
```

Report the subagent's result back to the user when it completes.

## Core principle

**Short and concise; the diff is the spec.** The reviewer can read the code. Spend words only where reasoning is *not* recoverable from the diff: the *why* (Motivation), non-obvious decisions or trade-offs, and evidence it works (Proof of Work). Detail is earned by non-obviousness, not spent by default.

**Test, lint and build results are not evidence anywhere in the description** — not in Proof of Work, not as a footnote after real output, not in a risk note. CI already shows the reviewer those; a green count in the body reads as proof without being any, and pushes the real evidence down.

### Length budget — the whole description, not per section

**Target ~400 words. Treat 600 as the ceiling** for even a large, subtle PR. A description past that is not thorough, it is unread: reviewers skim walls of prose and the one load-bearing sentence gets skimmed with the rest.

| Section | Budget |
|---|---|
| Preamble (optional, before `## Motivation`) | 1–2 lines. Usually skip it. |
| `## Motivation` | **2–3 sentences.** |
| `## Implementation` | **2–4 bullets**, ~2 lines each. |
| `## Proof of Work` | 3–4 short lines framing the pasted output (how you ran it, without, with, `**Not proven locally:**`); the output itself trimmed to the lines carrying the claim. |
| `## Verify on dev` | 1 framing line + 3–5 boxes. |
| Any optional prose section | ≤3 sentences or ≤3 bullets. A diagram: ≤12 nodes and one caption line. |

**Pasted command output does not count toward the word budget** — it is evidence, not prose.

The commonest failure is a *well-written* description that is simply too long — every sentence defensible, the whole thing three times the size it needed. Two habits cause it, and both are worth naming because they feel like diligence:

- **Explaining a decision you already explained in a code comment.** If the reasoning lives in a comment next to the code, the description gets the one-line version and a pointer, not the argument again.
- **Justifying each choice against the alternative you rejected.** One clause is enough (`not an `instanceof` table — a table silently misses a new subclass`). A paragraph per rejected alternative is a design doc, and belongs in one.

**On the final pass, cut — do not polish.** Ask of every sentence: would a reviewer with the diff open be worse off without this? If not, delete it. Aim to remove a third of the first draft.

## The repo's own template wins

**Before picking a form, look for a PR template in the repo.** When one exists it is the team's agreed shape, so it is the shape this description takes — this skill becomes *how to fill it in*, not a structure to impose over it.

```bash
ls .github/pull_request_template.md .github/PULL_REQUEST_TEMPLATE.md \
   PULL_REQUEST_TEMPLATE.md docs/pull_request_template.md 2>/dev/null
ls .github/PULL_REQUEST_TEMPLATE/ 2>/dev/null   # a directory means several templates — pick by change type
```

Found one → say so ("this repo has a PR template at `<path>` — filling that in"), map its slots to sections by intent — Why/Context/Background → Motivation, What/Changes/How → Implementation, Testing/Evidence/Screenshots → Proof of Work, QA/Rollout/Post-deploy → Verify on dev, Summary/TL;DR → one plain sentence — and read `references/repo-template.md` for how to fill it.

## What the repo itself provides

Some repos carry their own skills about proving work there, and their own worked examples. Find them rather than assuming a path:

```bash
ls .claude/skills/*/SKILL.md .claude/skills/*/references/*.md 2>/dev/null
```

Read any whose name is about proof, evidence, QA, or PR descriptions. A repo skill about proving work supplies what this skill cannot know: how to bring the stack up here, the seeded credentials, the screenshot tooling, where evidence assets live — use it for all of that. The bar itself travels with this skill: both halves of the run, real pasted output, no test results standing in for evidence. A repo file that adds a check raises the bar and you follow it; a repo file that would let you show less still gets its commands used, at this skill's bar. A repo's worked examples supply register and shape, not a structure to copy.

## Pick the form first

**No repo template? Then classify the diff** before writing a word. The full structure is the default, but three kinds of PR get a shorter form, and choosing wrong is the most common way this skill produces bloat.

| The diff touches | Form | Sections |
|---|---|---|
| Only documentation | `references/docs-only.md` | Motivation + Implementation. No Proof of Work. |
| Only configuration | `references/config-only.md` | One prose block + a before/after table. Nothing else. |
| A package bump + call-sites | `references/package-bump.md` | Motivation + Implementation + one-line Proof of Work |
| Anything else, or a mix | Full structure (below) | All three, **plus `## Verify on dev` whenever the change ships in a deployed service** |

**Judge by what consumes the file, not by its extension.** A `.yaml`, `.json` or `.prisma` under a docs path that nothing generates from is docs. A `.md` that CI publishes or that ships in an image is not. A workflow file, an eslint or tsconfig rule, or a Dockerfile edit alters what runs — it takes the full structure, not config-only, however self-explanatory its diff looks. **A mix falls back to the full structure**: a PR that changes docs *and* application code is not a docs PR. The short forms are for PRs where the excluded section would be genuinely empty, not for PRs where gathering it is inconvenient.

## Structure (the default)

```markdown
## Motivation
## Implementation
## Proof of Work
## Verify on dev
```

Add an optional section (`## Performance`, `## Migration`, `## Risk`, or a Mermaid diagram — `references/visualization.md`) only when the change raises a question the reviewer will otherwise ask. The budget table caps it.

## Section guidance — one file per section you write

The form you picked names its sections. Read one file per section you will write, and nothing else — a docs-only PR never needs `proof-of-work.md` in context.

| Section | File |
|---|---|
| Motivation | `references/motivation.md` |
| Implementation | `references/implementation.md` |
| Proof of Work | `references/proof-of-work.md` |
| Verify on dev | `references/verify-on-dev.md` — read `proof-of-work.md` first; this one carries its `**Not proven locally:**` line down |
| Diagram (optional) | `references/visualization.md` |

A short form's file replaces the per-section files, and is the whole description: the headings it lists are the headings the PR gets. With a repo template, `references/repo-template.md` plus the slot mapping above decide which files you need — decide first, then read; a slot you are not filling does not earn its file in context.

## Process

1. **Probe once** — the three `ls` lines above (template paths, template directory, repo-local skills) in a single call.
2. `git diff --name-only origin/main...HEAD` → pick the form, or with a template, map its slots.
3. `git diff origin/main...HEAD` — every form needs it; config-only's before/after table takes its *before* column from here.
4. Write each section the form calls for, reading its file from the table as you get to it.
5. **Cut.** Word-count the prose; over ~600, remove rather than rewrite until it fits the budget table.

## Common mistakes

**A heading is a promise that something is under it, and the promise is kept with evidence the diff does not already carry.** A Proof of Work reading "N/A", a `## Verify on dev` on a change nothing deploys, a docs PR narrating its own bullets back as proof — all are that one promise broken, and each section's file names its own versions. Three belong to the description as a whole:

| Mistake | Fix |
|---|---|
| Ignoring a PR template the repo already has | Look before drafting; its headings and order are the shape, this skill is how to fill them |
| Deleting a template section that felt empty | Keep the heading, put one honest line under it — the team agreed on that section, and this is the one place an honest "nothing here" beats an absent heading |
| No proof and no script, on a PR that runs something | Block merge — a script is the fallback when live invocation is impossible, never an empty section |

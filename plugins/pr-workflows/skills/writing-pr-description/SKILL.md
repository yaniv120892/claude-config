---
name: writing-pr-description
description: Use when writing or updating a pull request description. Fills in the repo's own PR template when there is one; otherwise generates a plain-language Motivation, a file-anchored Implementation, a Proof of Work built from actually running the code before and after, and Verify-on-dev acceptance criteria — with shorter forms for docs-only, config-only, and package-bump PRs.
---

# Writing PR Descriptions

## Overview

A PR description is the primary context reviewers and future readers have for understanding a change. It must answer four questions, each for a different reader: **Why was this needed?** — in plain words, for the product person. **Which files changed, and what does each do for the feature?** — for the reviewer. **What happened when you ran it, before and after?** — for anyone who has to trust it. **What gets checked once it is deployed?** — for whoever is on the other side of the merge.

Those four are the default shape. **A PR template already in the repo replaces it** — see **The repo's own template wins** below. The last two only exist when the change *does* something at runtime. A docs-only PR has no Proof of Work section at all, and a config-only PR has no Implementation or Proof of Work section — see **Pick the form first** below. `## Verify on dev` appears whenever the change ships inside a deployed service.

**Announce at start:** "I'm using the writing-pr-description skill."

## Delegate to a Sonnet subagent

**Do not draft the description inline in the current conversation.** Writing a PR description is a formatting/synthesis task — it doesn't need this session's model tier, and drafting it inline means it inherits the whole session's accumulated context (large diffs, prior tool output) at whatever cache/token cost that carries, often on a more expensive model than the task needs.

**Anti-recursion guard:** if your own task prompt already identifies you as the dispatched writing-pr-description subagent, skip this section entirely and go straight to **Core principle** below — do not delegate again.

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
    Check for a repo PR template first and fill that in if one exists.
    Read the diff, and gather Proof of Work yourself by actually running the
    code — you have Bash access, so run the service or a script locally on this
    branch and again on the base branch, and paste both outputs. Then apply the
    final description via `gh pr edit --body` / `gh pr create --body`."
})
```

Fill in the repo path, ticket, and base branch from what you already know in this conversation. Report the subagent's result back to the user when it completes.

**Core principle — short and concise; the diff is the spec.** The reviewer can read the code. Spend words only where reasoning is *not* recoverable from the diff: the *why* (Motivation), non-obvious decisions or trade-offs, and evidence it works (Proof of Work). Detail is earned by non-obviousness, not spent by default.

### Length budget — the whole description, not per section

**Target ~400 words. Treat 600 as the ceiling** for even a large, subtle PR. A description past that is not thorough, it is unread: reviewers skim walls of prose and the one load-bearing sentence gets skimmed with the rest.

| Section | Budget |
|---|---|
| Preamble (optional, before `## Motivation`) | 1–2 lines — what this is and what it targets. Usually skip it. |
| `## Motivation` | **2–3 plain sentences** a product person reads once and gets. No acronyms, no code names. |
| `## Implementation` | **2–4 bullets**, one per implementation file or tight group, ~2 lines each. No test files. |
| `## Proof of Work` | How you ran it, then the same command's output without the change and with it. |
| `## Verify on dev` | One framing line + 3–5 acceptance checkboxes: healthy, sane, then the local check on dev. |

**Pasted command output does not count toward the word budget** — it is evidence, not prose. Trim it to the lines that carry the claim and it stays cheap to read.

The commonest failure is a *well-written* description that is simply too long — every sentence defensible, the whole thing three times the size it needed. Two habits cause it, and both are worth naming because they feel like diligence:

- **Explaining a decision you already explained in a code comment.** If the reasoning lives in a comment next to the code, the description gets the one-line version and a pointer, not the argument again.
- **Justifying each choice against the alternative you rejected.** One clause is enough (`not an `instanceof` table — a table silently misses a new subclass`). A paragraph per rejected alternative is a design doc, and belongs in one.

**On the final pass, cut — do not polish.** Ask of every sentence: would a reviewer with the diff open be worse off without this? If not, delete it. Aim to remove a third of the first draft.

## The repo's own template wins

**Before picking a form, look for a PR template in the repo.** When one exists it is the team's agreed shape, so it is the shape this description takes — the sections below become *how to fill it in*, not a structure to impose over it.

```bash
ls .github/pull_request_template.md .github/PULL_REQUEST_TEMPLATE.md \
   PULL_REQUEST_TEMPLATE.md docs/pull_request_template.md 2>/dev/null
ls .github/PULL_REQUEST_TEMPLATE/ 2>/dev/null   # a directory means several templates — pick by change type
```

When one is found:

- **Say so.** Open the report to the user with "this repo has a PR template at `<path>` — filling that in" so nobody wonders why the headings differ from the usual four.
- **Keep its headings, their wording, and their order.** Also keep its checklists, and tick the boxes honestly.
- **Map this skill's guidance onto its sections by intent, not by name** — a "Why"/"Context"/"Background" section gets the plain-language Motivation, "What"/"Changes"/"How" gets the file-anchored Implementation, "Testing"/"Evidence"/"Screenshots" gets the before/after run, and "QA"/"Rollout"/"Post-deploy" gets the acceptance criteria.
- **A "Summary" or "TL;DR" slot wants one plain sentence of what the PR does**, in the Motivation's register. Opening it with file names puts the Implementation in the wrong box and leaves the reader no plain-language answer anywhere.
- **Replace the author instructions with the answer.** An HTML comment or a `<placeholder>` prompting for content goes away once the content is there.
- **A section with nothing to say keeps its heading and gets one honest line** ("No user-facing change — nothing to check after deploy"). Deleting a heading the team agreed on is overriding the template; this rule outranks the usual "an empty section is worse than an absent one".
- **Add a heading of your own only for something the template has no home for** — usually the before/after run — and put it **after the template's last heading, checklist included**. A checklist is part of the template, not a trailer to slot things in front of.

The length budget, the plain-language Motivation, the one-bullet-per-file Implementation and the run-it-both-ways proof all still apply inside the template's sections. Only the headings and their order come from the repo.

`gh pr create --body` overwrites whatever GitHub would have pre-filled, so a template is only honored if it is read and filled in deliberately.

## What the repo itself provides

Two things a repo can carry that this skill reads when they exist and ignores otherwise:

- **`.claude/skills/proof-of-work/SKILL.md`** — how to prove things *in this app*: bringing the stack up, seeded credentials, screenshot tooling, where evidence assets live. Read it before gathering proof. `references/proof-of-work.md` still owns *what counts* as proof; the repo file owns *how to produce it here*, and where the two disagree on what counts, this skill wins.
- **`.claude/skills/pr-description/references/*.md`** — worked examples in the repo's own voice, from its own merged PRs. Read them for register and shape, not as a template to fill.

## Pick the form first

**No repo template? Then classify the diff** before writing a word. The full structure is the default, but three kinds of PR get a shorter form, and choosing wrong is the most common way this skill produces bloat.

| The diff touches | Form | Sections |
|---|---|---|
| Only documentation | Docs-Only (`references/short-forms.md`) | Motivation + Implementation. **No Proof of Work.** |
| Only configuration | Config-Only (`references/short-forms.md`) | One prose block + a before/after table. Nothing else. |
| A package bump + call-sites | Package Bump (`references/short-forms.md`) | Motivation + Implementation + one-line Proof of Work |
| Anything else, or a mix | Full structure (below) | All three, **plus `## Verify on dev` whenever the change ships in a deployed service** |

**A mix falls back to the full structure.** If a PR changes docs *and* application code, it is not a docs PR — describe the code change properly. The short forms are for PRs where the excluded section would be genuinely empty, not for PRs where gathering it is inconvenient.

## Structure (the default)

```markdown
## Motivation

<Why this change exists, in plain words a product person gets on one read: what someone hits today, what it costs them, why it is worth fixing now. 2–3 sentences, no acronyms, no code names.>

## Implementation

- **`<path/to/file>`** — <what it now does and how that serves the core of this PR. One bullet per implementation file or tight group; no test files. 2–4 bullets.>

## Proof of Work

<How you ran it locally, then the same command's output without this change and with it. See `references/proof-of-work.md`.>

## Verify on dev

<Acceptance criteria for after the deploy: the service is healthy, the surrounding flow is sane, and the local check repeats on dev. See `references/verify-on-dev.md`.>
```

Add an optional section (e.g. `## Performance`, `## Migration`, `## Risk`) only when the change raises a question the reviewer will otherwise ask — a perf trade-off, a data migration, a rollout concern. Keep it tight and skip it when there's nothing non-obvious to say. A Mermaid diagram between Implementation and Proof of Work is the same kind of optional: earned by an architectural or asynchronous change, never by a local one — `references/visualization.md` says when and how.

## Section guidance — read only what you are writing

Each section's rules, examples and failure modes live in its own file. Read the file for every section the chosen form includes, and skip the rest — a docs-only PR never needs `proof-of-work.md` in context.

| Section | File | Read it when |
|---|---|---|
| Motivation | `references/motivation.md` | Always, unless config-only |
| Implementation | `references/implementation.md` | Always, unless config-only |
| Proof of Work | `references/proof-of-work.md` | The change runs something — never docs-only or config-only |
| Verify on dev | `references/verify-on-dev.md` | The change ships in a deployed service. Read `proof-of-work.md` first; this one builds on its `**Not proven locally:**` line |
| Docs-only / config-only / package bump | `references/short-forms.md` | The form table above picked one of those |
| Diagram (optional) | `references/visualization.md` | The change is architectural, asynchronous, or crosses component boundaries |

With a repo template, map its slots to these files by intent (see **The repo's own template wins**) and read the file for each slot you fill. Decide the mapping from the table first, then read — a slot you are not filling does not earn its file in context.
## Process

1. **Look for a repo PR template** (`.github/pull_request_template.md` and the other paths above) and for the repo-local files in **What the repo itself provides**. A template found → its headings and order are the description's shape; say so in the report and fill it in with the guidance below.
2. Read the git diff: `git diff origin/main...HEAD`
3. **Pick the form** — only when there is no template. Check the file list against the table above before writing anything; `git diff --name-only origin/main...HEAD` is usually enough to classify it.
4. Group changes by component/concern
5. Write Motivation — plain words for a product reader, no acronyms, 2–3 sentences
6. Write Implementation — 2–4 bullets, one per implementation file, each tied to what the PR is for; no test files. Skip for config-only.
7. Gather Proof of Work — **run it locally both ways** and paste the before/after output. **Skip the section entirely for docs-only and config-only**; do not replace it with a placeholder.
8. Write `## Verify on dev` — healthy, sane, then the local check repeated on dev, each box with its command. Omit only when nothing reaches a deployed environment.
9. **Cut.** Word-count the prose (pasted output doesn't count); over ~600, remove rather than rewrite until it fits the budget table.
10. Format using `gh pr edit --body` or `gh pr create --body`

## Common Mistakes

| Mistake | Fix |
|---------|-----|
| Implementation names files with no link to the feature | Keep the path, add what that file does for this PR — the link is the point |
| "Tests pass", lint, or typecheck results in Proof of Work | Delete the line and run the code instead — paste what it printed |
| Proof of Work shows only the new behavior | Run the base branch the same way and paste that too; without the *before*, nothing is proven |
| "I tested it locally" with nothing attached | Name the command and show its output, or write a script and show that |
| No proof and no script, on a PR that runs something | Block merge — a script is the fallback when live invocation is impossible, never an empty section |
| A Proof of Work section reading "N/A", "docs only", or "✅ lint passes" | Delete the heading. An empty section is worse than an absent one — it implies evidence nobody gathered |
| Ignoring a PR template the repo already has | Look before drafting; its headings and order are the shape, this skill is how to fill them |
| Deleting a template section that felt empty | Keep the heading, put one honest line under it — the team agreed on that section |
| Missing entire sections, or the full structure on a docs-only PR | Check the form table first. All four are required *unless* the diff is docs-only (no Proof of Work) or config-only (Motivation only); a docs PR narrating its own bullet list back as "proof" is the usual symptom of skipping that check |
| A deployed change with no `## Verify on dev` | Add it — otherwise nobody, including the author next week, can say what would count as this working after the deploy |
| `## Verify on dev` bullets like "verify metrics work" | Every box pairs an observable outcome with the command that observes it |
| `## Verify on dev` added to a change nothing deploys | Delete the heading — it implies a verification nobody intends to run |

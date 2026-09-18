---
name: writing-pr-description
description: Use when writing or updating a pull request description. Generates a plain-language Motivation, a file-anchored Implementation, a Proof of Work built from actually running the code before and after, and Verify-on-dev acceptance criteria — with shorter forms for docs-only, config-only, and package-bump PRs.
---

# Writing PR Descriptions

## Overview

A PR description is the primary context reviewers and future readers have for understanding a change. It must answer four questions, each for a different reader: **Why was this needed?** — in plain words, for the product person. **Which files changed, and what does each do for the feature?** — for the reviewer. **What happened when you ran it, before and after?** — for anyone who has to trust it. **What gets checked once it is deployed?** — for whoever is on the other side of the merge.

The last two only exist when the change *does* something at runtime. A docs-only PR has no Proof of Work section at all, and a config-only PR has no Implementation or Proof of Work section — see **Pick the form first** below. `## Verify on dev` appears whenever the change ships inside a deployed service.

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
    Read the diff, and gather Proof of Work yourself by actually running the
    code — you have Bash access, so run the service or a script locally on this
    branch and again on the base branch, and paste both outputs. Then apply the
    final description via `gh pr edit --body` / `gh pr create --body`."
})
```

Fill in the repo path, ticket, and base branch from what you already know in this conversation. Report the subagent's result back to the user when it completes.

**Core principle — short and concise; the diff is the spec.** The reviewer can read the code. Spend words only where reasoning is *not* recoverable from the diff: the *why* (Motivation), non-obvious decisions or trade-offs, and evidence it works (Proof of Work). Keep Implementation as short as possible — it points at the files that changed and what each one is for, it does not re-explain the code. Detail is earned by non-obviousness, not spent by default. When a section has nothing non-obvious to add, keep it to one line rather than padding it.

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

## Pick the form first

Classify the diff before writing a word. The full structure is the default, but three kinds of PR get a shorter form, and choosing wrong is the most common way this skill produces bloat.

| The diff touches | Form | Sections |
|---|---|---|
| Only documentation | [Docs-Only](#short-form-for-docs-only-changes) | Motivation + Implementation. **No Proof of Work.** |
| Only configuration | [Config-Only](#short-form-for-config-only-changes) | One prose block + a before/after table. Nothing else. |
| A package bump + call-sites | [Package Bump](#short-form-for-a-package-bump) | Motivation + Implementation + one-line Proof of Work |
| Anything else, or a mix | [Full structure](#structure-the-default) | All three, **plus `## Verify on dev` whenever the change ships in a deployed service** |

**A mix falls back to the full structure.** If a PR changes docs *and* application code, it is not a docs PR — describe the code change properly. The short forms are for PRs where the excluded section would be genuinely empty, not for PRs where gathering it is inconvenient.

## Short Form for Docs-Only Changes

For PRs that change **only documentation** — design docs, READMEs, ADRs, runbooks, rule files, comments-only edits — use Motivation + Implementation and **stop there**. There is no Proof of Work section: nothing executes, so there is no runtime evidence to gather, and a section saying so is padding.

**What counts as docs-only:** no file that the build, the runtime, or CI consumes. Judge by what reads the file, not by its extension:

- A `.prisma`, `.yaml`, or `.json` file under a docs path that nothing generates from **is** docs — say so explicitly in the description, because the extension will make a reviewer assume otherwise.
- A `.md` that CI publishes, or that ships in a runtime image as a template, is **not** docs.
- A comments-only change to a source file is docs *in spirit*, but the diff still touches `src/` — say what the comment now claims and why the old one was wrong.

```markdown
## Motivation

<Why the document needed to change: what a reader would have concluded from the old text, and what
that would have cost them. 2–3 plain sentences, same as the full form. "It was out of date" is not a
motivation — say what was wrong and what it would have led someone to do.>

## Implementation

- **`<file>`** — <what it now says, and what changed in substance rather than in wording.>
```

**Optional `## Provenance`** — for a *design* doc, where the claims come from is the nearest thing to proof, and it is worth having when the document asserts numbers, measurements, or decisions attributed to someone. Keep it to a few bullets naming the source and date. Skip it entirely for a README or a runbook.

**Good example:**
```markdown
## Motivation

`docs/local-container-e2e.md` still told developers to run `pnpm db:reset`, which trips Prisma's
dangerous-action guard under CI and agents — so anyone following it hit a confusing abort partway
through setup and had no way to know the doc was the problem.

## Implementation

- **`docs/local-container-e2e.md`** — `db:reset` → `db:deploy` throughout, with a line explaining
  that the catalog ships as idempotent DATA migrations so there is no separate seed step.
```

Do not add a Proof of Work section reading "N/A", "docs only", or "✅ lint passes". Omit the heading.

## Short Form for a Package Bump

For PRs whose primary change is **bumping a shared package version** (e.g. `@models/core.common.model`) and updating call-sites to use a newly exported type or value, skip the full structure and use this compact format instead:

```markdown
## Motivation

<One sentence: what was duplicated/missing and why the shared type fixes it.>

## Implementation

- **`<file>`** — <what it now imports/uses from the package, one bullet per file>.
- Bumps `<package>` to `<version>`.

## Proof of Work

Ran <the call site> locally against the bumped package:

```
<the command + its output, showing the new type/value in use>
```
```

## Short Form for Config-Only Changes

For PRs whose only change is configuration — Helm/Kubernetes values, Terraform, Crossplane manifests, resource requests/limits, replica counts, env vars — with no application code and therefore nothing to build/lint/test, skip the full structure entirely. There is no Implementation or Proof of Work section: the diff (a values file) is already fully self-explanatory line-by-line, and there's no runtime evidence to gather pre-merge.

**The test is whether the diff explains itself line-by-line.** A values file does; a config file that *changes behaviour* does not, and does not get this form. A `.github/workflows/*.yml` job change, an `eslint.config.mjs` rule, a `tsconfig` path, or a Dockerfile edit all alter what runs — they take the full structure, and their Proof of Work is a pipeline job list, a resolved-config dump (`npx eslint --print-config <file>`), or a built image, not a claim that the file was edited.

Use one short prose block (what changed + why, folded together — this doubles as the Motivation) plus a before/after table:

```markdown
<1–4 sentences: what the service/component does (only if the reviewer needs that context), where/how the
problem shows up (an incident, a metric, an OOM event), and why these specific new values were chosen —
not just that they changed.>

| | before | after |
|---|---|---|
| `<field>` | <old value> | **<new value>** |

<Optional one-line scope/rollout note, e.g. "Prod only — dev unchanged.">
```

**Good example (from an `eks-services-gitops` PR):**
```markdown
`ai-models-error-mapping`'s **implement** phase clones 4 repos, installs deps, and drives the Claude CLI
inside a single pod — a resource-heavy burst on top of otherwise low, scheduler-driven traffic. On
2026-07-21, an implement run was OOM-killed (exit 137) ~38 min in, even after an earlier 1Gi→3Gi/4Gi bump.

| | before | after |
|---|---|---|
| `requests.memory` | 3Gi | **6Gi** |
| `limits.memory` | 4Gi | **8Gi** |

**Prod only — dev unchanged.**
```

Don't add Implementation/Proof of Work headers "for consistency" — an empty or padded section here is worse than no section. If the same PR *also* touches application code (not just values), fall back to the full structure below for that PR instead.

## Structure (the default)

```markdown
## Motivation

<Why this change exists, in plain words a product person gets on one read: what someone hits today, what it costs them, why it is worth fixing now. 2–3 sentences, no acronyms, no code names.>

## Implementation

- **`<path/to/file>`** — <what it now does and how that serves the core of this PR. One bullet per implementation file or tight group; no test files. 2–4 bullets.>

## Proof of Work

<How you ran it locally, then the same command's output without this change and with it. See "Proof of Work" below.>

## Verify on dev

<Acceptance criteria for after the deploy: the service is healthy, the surrounding flow is sane, and the local check repeats on dev. See "Verify on dev" below.>
```

Add an optional section (e.g. `## Performance`, `## Migration`, `## Risk`) only when the change raises a question the reviewer will otherwise ask — a perf trade-off, a data migration, a rollout concern. Keep it tight and skip it when there's nothing non-obvious to say.

## Section Guidelines

### Motivation

Answer: **Why does this change exist?** Write it for the product person reading the PR, not for the reviewer — they should get it on one read, without opening the diff and without asking what a word means.

**Length: 2–3 sentences. Hard cap.** The shape that fits in three: what someone hits today → what that costs → why it is worth fixing now.

- **Plain words.** "The upload fails for large files" rather than "the multipart ingestion path throws". A word that only makes sense to someone who has read the code belongs further down.
- **Spell out an acronym or drop it.** Ticket keys, enum values, class names, queue names, table names, feature-flag keys — all of it lives in Implementation.
- Name the cost of not shipping it. A motivation with no consequence in it is a summary.
- Reference the ticket only when it adds context a sentence cannot.

**Good example (from AIP-322):**
> Customers on the unlimited plan pay for fast image generations out of a separate balance. Today the service either rejects those customers outright or quietly spends their regular credits, so they lose money they already paid for. This change sends each request to the balance it belongs to, and falls back to the slower queue once the fast allowance runs out.

**Bad examples:**
- ❌ "Wires the routing layer so each `generationMethod` maps to its correct wallet operation, with graceful degradation to `unlimited_slow`" — accurate, and unreadable for the audience this section is written for
- ❌ "Added generationMethod support" — describes what, not why
- ❌ "As per AIP-339" — sends the reader off to find the ticket
- ❌ "This PR implements the package resolution feature" — circular
- ❌ A motivation naming six components and three design decisions — that is Implementation's job

### Implementation

Technical, and anchored on the files. **One bullet per implementation file** — or per tight group of files doing one job — naming the path and what it contributes to the feature, so a reviewer knows which file to open first and why.

**Length: 2–4 bullets, ~2 lines each.** List only the files carrying the implementation; tests, fixtures, snapshots and lockfiles are assumed and stay out. When the change spans more files than bullets, fold the supporting ones into the bullet of the file they serve ("…plus its two call sites in `x/` and `y/`").

- Lead with the path in backticks, then what it now does and how that serves the core of this PR.
- Say the decision that is not obvious from reading the file; skip the narration that is.
- A flat list is the form — `###` subsections here are almost always the length budget being dodged.

**Good example (small, focused PR):**
```markdown
## Implementation
- **`src/worker/init.ts`** — calls a new `configureSharp()` once at worker startup (`sharp.cache(false)` + `sharp.concurrency(1)`); this is what caps the resident memory the PR is about.
- Activity-side only — no workflow command changed, so there is no `patched()` concern.
```

**Good example (larger PR):**
```markdown
## Implementation
- **`src/wallet/route-wallet-by-method.ts`** — new, and the core of the PR: maps each `generationMethod` to its wallet operation, falling back to `unlimited_slow` on `INSUFFICIENT_BALANCE`.
- **`prisma/schema.prisma` + `src/generation/persist.ts`** — adds `effectiveMethod` next to `generationMethod` and writes both in one update, so a record shows what the client asked for vs what ran.
- **`src/metrics/index.ts`** — `wallet_route_downgrade_total`, labeled by reason, which is what makes that fallback visible in production.
```

**Bad examples:**
- ❌ "Modified controller.ts and workflow-types.ts" — names files with no link to the feature; the link is the whole point
- ❌ A bullet for a `.spec.ts`, fixture, or snapshot — never list tests
- ❌ Subsections with one bullet each — flatten
- ❌ Restating the Motivation, or narrating code the reviewer can read in the diff

### Proof of Work

**Run it, and paste what happened — both ways.** The reviewer should be able to see what the code does wrong without this PR and what it does instead with it, from output you actually produced on your machine.

Run the service locally where the change is reachable that way (`docker compose up`, `pnpm dev`, the worker entrypoint) and drive the changed path for real. Where it is not reachable — no running service, external keys needed, a database-dependent flow — write a script that drives the real module with realistic data, and run that instead. Either way, produce the *without* half too: `git stash`, check the files out from the base branch, or turn the new path off, and run the identical command again.

**Format:**

````markdown
## Proof of Work

Ran the worker locally over 200 source images with `scripts/repro-oom.sh` (included below).

**Without this change** — resident memory climbs until the process is killed:
```
[worker] processed 12 images
Killed (exit 137), peak RSS 3.9GB
```

**With this change** — the same run finishes, memory flat:
```
[worker] processed 200 images
done in 41s, peak RSS 412MB
```

**Not proven locally:** the dev pod is capped at 4Gi, half this laptop's headroom.
````

- **Both halves, same command.** One-sided output proves the code runs, not that it fixes anything.
- **Say how you ran it** — the command, the script, the endpoint — so a reviewer can reproduce it. Paste a short script inline in a fenced block, or commit it and name the path.
- **Paste real output**, trimmed to the lines carrying the claim. A description of the output is not the output.
- **Close with `**Not proven locally:**`** naming what the run could not reach. That line is the raw material for `## Verify on dev`.
- Where there is genuinely no *before* — a brand-new endpoint — the 404 from the base branch is the before. Show it.

**What counts as the run:**
- A live call: `curl` against the local service, plus the response body.
- A Temporal workflow run ID + status, or the history event showing the new field.
- Log lines showing the new behavior, on both sides.
- A metrics sample: `curl localhost:9090/metrics | grep <metric_name>`.
- For a UI flow, a numbered frame sequence (`01-empty-form.png` → `04-success.png`) or a GIF — the route, not just the destination. `gh` cannot attach media to a PR body, so these get dragged in through the web UI; cite a frame only once it is actually attached.
- A script that imports the real module and runs on real data shapes — labeled `Script output:`, not dressed up as a live service call.

Test results, lint, typecheck and build status stay out of this section entirely. They are the baseline, the reviewer already sees them on the PR, and a line claiming them is the most common substitute for evidence nobody gathered.

### Verify on dev

Acceptance criteria for after the merge deploys: what someone opens, runs, and looks at to call this change good on dev. The thinking already happened while gathering proof — this is the `**Not proven locally:**` line turned into a checklist, plus the sanity checks that say the service survived the deploy at all.

**Include it whenever the change ships inside a deployed service.** It is always at least these three, in this order:

1. **The service is up** — the rollout finished and the health endpoint answers.
2. **Sanity** — the surrounding flow still works: one existing request path returns what it returned before this PR.
3. **The proof, on dev** — the same check from Proof of Work run against dev, showing the *with this change* outcome.

Then add a box for anything only the deployed accounts can settle: a value the environment supplies from a secret store, queue/topic/routing wiring, an endpoint default that pointed at local infrastructure, ingress/probe/auth reachability, the runtime dependency set baked into the image, or a contract against a real upstream.

**Format — one framing line, then each criterion paired with the command that settles it:**

```markdown
## Verify on dev

**Only dev can prove:** `TRANSACTION_ROUTING_KEY` matches the SNS `filterPolicy` — that pairing exists only in the deployed accounts.

- [ ] **Rollout finished and the service answers** — `kubectl -n dev rollout status deploy/<deployment>`, then `curl -s "$DEV_API/health"` → `{"status":"ok"}`
- [ ] **Existing jobs still complete** — submit a normal job, `curl -s "$DEV_API/jobs/<id>" | jq .status` → `completed`
- [ ] **The new path runs on dev** — same check as Proof of Work: `kubectl -n dev logs deploy/<deployment> | grep 'transaction settled'` shows a non-null ticket
- [ ] **Memory stays flat under the same batch** — `kubectl -n dev top pod -l app=<app>` well under the 4Gi limit
```

- **Every box names a command and the outcome that command should show.** "Check it works" is the same omission wearing a heading.
- A green pipeline never settles a box — nothing in CI runs the deployed image.
- Omit the section only when nothing about the change reaches a deployed environment.

## How to Gather Proof

1. **Get the *after* first.** Start the service the way you normally would locally (`docker compose up`, `pnpm dev`, the worker entrypoint) and drive the changed path for real — a `curl`, a queued job, a workflow start, a click-through.
2. **Then get the *before*.** `git stash`, or `git checkout origin/main -- <changed files>`, or turn the new flag/env off; run the identical command; restore afterwards. Copy both outputs while you have them.
3. **When the service cannot run locally** — external keys, a real database, a third-party upstream — write a script that imports the real module and feeds it real or realistic data (`curl` the upstream schema, read a fixture), run it on both sides, and paste the script with both outputs.
4. **For workflow changes** — run the workflow and copy the run ID from the Temporal UI (`http://localhost:8233`); paste the run ID and the event showing the new field.
5. **For metrics** — `curl localhost:9090/metrics | grep <metric_name>` after each run.
6. **Write down what the run could not reach** as you go. That is the `**Not proven locally:**` line, and it is what `## Verify on dev` is built from.

## Process

1. Read the git diff: `git diff origin/main...HEAD`
2. **Pick the form** — check the file list against the table above before writing anything. `git diff --name-only origin/main...HEAD` is usually enough to classify it.
3. Group changes by component/concern
4. Write Motivation — plain words for a product reader, no acronyms, 2–3 sentences
5. Write Implementation — 2–4 bullets, one per implementation file, each tied to what the PR is for; no test files. Skip for config-only.
6. Gather Proof of Work — **run it locally both ways** and paste the before/after output. **Skip the section entirely for docs-only and config-only**; do not replace it with a placeholder.
7. Write `## Verify on dev` — healthy, sane, then the local check repeated on dev, each box with its command. Omit only when nothing reaches a deployed environment.
8. **Cut.** Word-count the prose (pasted output doesn't count); over ~600, remove rather than rewrite until it fits the budget table.
9. Format using `gh pr edit --body` or `gh pr create --body`

## Common Mistakes

| Mistake | Fix |
|---------|-----|
| Motivation describes what, not why | Start from the consequence of not having the change |
| Motivation a product reader can't follow — acronyms, class names, enum values | Rewrite in plain words; every name moves down to Implementation |
| Implementation names files with no link to the feature | Keep the path, add what that file does for this PR — the link is the point |
| Implementation lists `.spec.ts`, fixtures, or snapshots | Remove them; only files carrying the implementation earn a bullet |
| Over-long Implementation narrating the diff | Cut to 2–4 bullets; the code is the spec, say only what isn't obvious from opening the file |
| Reflexively adding `###` subsections | Default to a flat list; subsections only for genuinely distinct components |
| "Tests pass", lint, or typecheck results in Proof of Work | Delete the line and run the code instead — paste what it printed |
| Proof of Work shows only the new behavior | Run the base branch the same way and paste that too; without the *before*, nothing is proven |
| Proof of Work describes the output instead of pasting it | Paste the real lines, trimmed to what carries the claim |
| "I tested it locally" with nothing attached | Name the command and show its output, or write a script and show that |
| No proof and no script, on a PR that runs something | Block merge — a script is the fallback when live invocation is impossible, never an empty section |
| A Proof of Work section reading "N/A", "docs only", or "✅ lint passes" | Delete the heading. An empty section is worse than an absent one — it implies evidence nobody gathered |
| Missing entire sections | All four required — *unless* the diff is docs-only (no Proof of Work) or config-only (Motivation only). Check the form table first |
| Full structure on a docs-only PR | Classify the diff before drafting; a docs PR narrating its own bullet list back as "proof" is the usual symptom |
| Short form on a PR that mixes docs and code | The short forms apply only when the excluded section would be genuinely empty, not when it's inconvenient to gather |
| A long description where every sentence is individually defensible | Length is the defect. Word-count it, cut to the budget table — a reviewer skims a wall and misses the load-bearing line |
| Re-arguing in prose what a code comment beside the change already says | One line and a pointer; the comment is the durable home for that reasoning |
| A paragraph per rejected alternative | One clause names the alternative and why not. More than that is a design doc |
| Bold lead-ins used as de-facto subsections to fit more in | That's the length budget being dodged. Consolidate into 2–4 bullets |
| A deployed change with no `## Verify on dev` | Add it — otherwise nobody, including the author next week, can say what would count as this working after the deploy |
| `## Verify on dev` bullets like "verify metrics work" | Every box pairs an observable outcome with the command that observes it |
| `## Verify on dev` that jumps straight to the new feature | Health and one existing flow come first — a deploy that broke the service fails every other box for the wrong reason |
| `## Verify on dev` added to a change nothing deploys | Delete the heading — it implies a verification nobody intends to run |

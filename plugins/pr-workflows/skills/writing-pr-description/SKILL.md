---
name: writing-pr-description
description: Use when writing or updating a merge request / pull request description. Generates short, budgeted Motivation, Implementation, Proof of Work and Verify-on-dev sections matching team conventions — with shorter forms for docs-only, config-only, and package-bump PRs.
---

# Writing PR Descriptions

## Overview

A PR description is the primary context reviewers and future readers have for understanding a change. It must answer four questions: **Why was this needed?** **What exactly changed and how?** **Does it actually work?** **And what can only a deployed environment prove?**

The last two only exist when the change *does* something at runtime. A docs-only PR has no Proof of Work section at all, and a config-only PR has no Implementation or Proof of Work section — see **Pick the form first** below. `## Verify on dev` appears only when the risk is deploy-shaped.

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
    Read the diff, gather Proof of Work yourself (you have Bash access), and
    apply the final description via `glab mr edit` / `glab mr create --description`."
})
```

Fill in the repo path, ticket, and base branch from what you already know in this conversation. Report the subagent's result back to the user when it completes.

**Core principle — short and concise; the diff is the spec.** The reviewer can read the code. Spend words only where reasoning is *not* recoverable from the diff: the *why* (Motivation), non-obvious decisions or trade-offs, and evidence it works (Proof of Work). Keep Implementation as short as possible — it points at what changed, it does not re-explain the code. Detail is earned by non-obviousness, not spent by default. When a section has nothing non-obvious to add, keep it to one line rather than padding it.

### Length budget — the whole description, not per section

**Target ~400 words. Treat 600 as the ceiling** for even a large, subtle PR. A description past that is not thorough, it is unread: reviewers skim walls of prose and the one load-bearing sentence gets skimmed with the rest.

| Section | Budget |
|---|---|
| Preamble (optional, before `## Motivation`) | 1–2 lines — what this is and what it targets. Usually skip it. |
| `## Motivation` | **2–3 sentences.** |
| `## Implementation` | **2–3 bullets**, ~2 lines each. |
| `## Proof of Work` | 3–5 bullets, one line each. |
| `## Verify on dev` | One `**Only dev can prove:**` line + 2–4 checkboxes. |

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
| Anything else, or a mix | [Full structure](#structure-the-default) | All three, **plus `## Verify on dev` if the risk is deploy-shaped** |

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
that would have cost them. 2–3 sentences. "It was out of date" is not a motivation — say what was
wrong and what it would have led someone to do.>

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

- <File>: <what changed, one line per file>.
- Bumps `<package>` to `<version>`.

## Proof of Work

✅ Build, lint, and prettier pass.
```

## Short Form for Config-Only Changes

For PRs whose only change is configuration — Helm/Kubernetes values, Terraform, Crossplane manifests, resource requests/limits, replica counts, env vars — with no application code and therefore nothing to build/lint/test, skip the full structure entirely. There is no Implementation or Proof of Work section: the diff (a values file) is already fully self-explanatory line-by-line, and there's no runtime evidence to gather pre-merge.

**The test is whether the diff explains itself line-by-line.** A values file does; a config file that *changes behaviour* does not, and does not get this form. A `.gitlab-ci.yml` job change, an `eslint.config.mjs` rule, a `tsconfig` path, or a Dockerfile edit all alter what runs — they take the full structure, and their Proof of Work is a pipeline job list, a resolved-config dump (`npx eslint --print-config <file>`), or a built image, not a claim that the file was edited.

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

**Good example (from an `eks-services-gitops` MR):**
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

<Why this change is needed — the business problem or capability gap, and what breaks or is missing without it. 2–3 sentences, engineering perspective, written for a reviewer who hasn't seen the ticket.>

## Implementation

- <What changed, one concise bullet per logical change — behavior/decision, not files. 2–3 bullets.>

## Proof of Work

<Concrete runtime evidence that the feature/fix works. See "Proof of Work" section below.>

## Verify on dev

<Only when the risk is deploy-shaped. See "Verify on dev" below — omit the heading entirely otherwise.>
```

Add an optional section (e.g. `## Performance`, `## Migration`, `## Risk`) only when the change raises a question the reviewer will otherwise ask — a perf trade-off, a data migration, a rollout concern. Keep it tight and skip it when there's nothing non-obvious to say.

## Section Guidelines

### Motivation

Answer: **Why does this change exist?** What was broken, missing, or inadequate before?

**Length: 2–3 sentences. Hard cap.** If you need more, you're explaining the implementation, not the motivation. Move it down. The shape that fits in three: what is missing or broken → what that costs → why now / why in this PR rather than the next one.

- Write from an engineering perspective, not marketing copy
- Include the consequence of NOT having this change
- Reference the ticket only if it adds context — don't pad with "as per AIP-XXX"
- Resist listing every component this PR touches — that's the Implementation section's job

**Good example (from AIP-322):**
> Users on unlimited plans have a separate FAST_GENERATIONS wallet. Without wallet routing, the service either hard-fails unlimited users or incorrectly draws from their CREDITS balance. This PR wires the routing layer so each `generationMethod` maps to its correct wallet operation, with graceful degradation to `unlimited_slow` when fast-generation quota is exhausted.

**Bad examples:**
- ❌ "Added generationMethod support" — describes what, not why
- ❌ "As per AIP-339" — forces reviewer to read the ticket
- ❌ "This PR implements the package resolution feature" — circular
- ❌ Motivation that lists 6 components and 3 design decisions — that belongs in Implementation

### Implementation

**As short as possible — the code is the spec.** A flat bulleted list, one bullet per logical change. Say what changed and any decision that isn't obvious from reading it; nothing more. If a bullet just narrates what the diff plainly shows, cut it.

**Length: 2–3 bullets, ~2 lines each; hard ceiling 4.** `###` subsections are almost always wrong here — a PR that seems to need them is usually one where the length budget is being dodged rather than one with genuinely distinct components. Never a subsection per file, and never a `**bold lead-in**` per paragraph as a subsection in disguise.

Related decisions belong in **one** bullet, not one each. Three bullets that all explain the same new class is a wall; one bullet naming the class and its two non-obvious choices is a sentence.

**Good example (small, focused PR — two lines is enough):**
```markdown
## Implementation
- `configureSharp()` (called once at worker `init()`): `sharp.cache(false)` + `sharp.concurrency(1)`.
- Activity-side only — no workflow command change, no `patched()` concern.
```

**Good example (larger PR, still compact):**
```markdown
## Implementation
- New `routeWalletByMethod` maps each `generationMethod` to its wallet operation; `UNLIMITED` falls back to `unlimited_slow` on `INSUFFICIENT_BALANCE`.
- `effectiveMethod` + `generationMethod` columns persisted in one Prisma update — what the client asked for vs what ran.
- Metrics: `wallet_route_downgrade_total` counter labeled by reason.
```

**Bad examples:**
- ❌ "Modified controller.ts and workflow-types.ts" — describes files, not behavior
- ❌ A bullet for "added unit tests" or any `.spec.ts` file — tests are assumed, never list them
- ❌ Subsections with one bullet each — just flatten
- ❌ Restating the Motivation, or narrating code the reviewer can read in the diff
- ❌ Padding to hit a bullet count — fewer is better

### Proof of Work

Evidence that the change works **in practice**, not just in tests. Reviewers need to trust the change before merging.

**Length: 3–5 bullets, one line each.** Lead each with the claim in bold, then the evidence — `**The redaction is proven able to fail.** Un-redacting turns 3 of 8 cases red.` A bullet that needs a paragraph is describing the implementation again. Consolidate suite/lint/typecheck results into **one** trailing line at most, never a bullet each.

**Close with a `**Not proven locally:**` line** naming what this evidence could not cover. That line is the raw material for `## Verify on dev` below — if it names something only a deployed environment can settle, that section is required.

**What counts as proof:**
- Temporal workflow run ID + status (completed/failed as expected)
- Log output showing the new field/behavior
- `curl` response from a live endpoint
- Prometheus metric sample showing the counter incremented
- Screenshot of Temporal UI showing the workflow ran through the new activity
- For a UI flow, a numbered frame sequence — `01-empty-form.png` → `04-success.png` — so the reviewer sees the route, not just the destination. Where the flow is the point and the forge renders it inline, a GIF of that sequence is worth more than the stills; a raw video file is not, since GitHub has no API for attaching one to a PR body

**What does NOT count:**
- Unit test results — tests are a baseline, not proof the feature works
- "Tests pass" — assumed; never mention this in the PR description
- "I tested it locally" — not verifiable
- Empty section

**When live invocation isn't possible** (no running service, external API keys required, DB-dependent flow), write a script instead:

- Write a focused Node.js or shell script that exercises the changed logic with real or realistic data
- Feed it real external data where available (e.g. `curl` a third-party API, read a fixture file)
- Capture the script's stdout and paste it as the proof — include the script itself so reviewers can reproduce it
- Label it clearly: `Script output:` rather than pretending it's a live service call

This is acceptable when the script exercises the actual production code path (imports the real module, uses real data shapes) rather than re-implementing the logic inline.

### Verify on dev

Some risks no local run and no pipeline can touch: the pairing that fails only exists in the deployed accounts. `## Verify on dev` is the author's `**Not proven locally:**` clause promoted from an apology into a checklist someone can settle after the merge deploys. It costs nothing extra to write, because the thinking already happened while gathering proof.

**Include it when the change is deploy-shaped** — at least one of:

- A config value consumed from a secret store / SSM, or any value the deployed environment must supply.
- Queue, topic, or routing wiring; an endpoint default that points at local infrastructure.
- Ingress, probe, or auth paths — including whether a route is publicly reachable.
- Image contents or the runtime dependency set (a devDependency reachable at runtime passes every gate and fails in a pod).
- A contract against a real upstream, or connection/queue settings for a workflow engine.

**Format — one framing line, then observable outcomes each paired with the command that observes it:**

```markdown
## Verify on dev

**Only dev can prove:** `TRANSACTION_ROUTING_KEY` matches the SNS `filterPolicy` — that pairing
exists only in the deployed accounts.

- [ ] **A job reaches `completed`** — `curl -s "$DEV_API/jobs/<id>" | jq .status`
- [ ] **The worker logs a settled transaction with a non-null ticket** —
      `kubectl -n dev logs deploy/<deployment> | grep 'transaction settled'`
```

- **Every bullet names a command and the outcome that command should show.** "Check it works" is the same omission wearing a heading.
- **Omit the whole section when the change carries no deploy-shaped risk.** A padded block is worse than none: it implies a verification nobody intends to run. Same stance as an empty `## Proof of Work`.
- A green pipeline is never the answer to a `## Verify on dev` bullet — nothing in CI runs the built image. Settling the block happens after the deploy, not before.

## How to Gather Proof

1. **For workflow changes:** Run the workflow locally or in dev, copy the run ID from Temporal UI (`http://localhost:8233`)
2. **For schema/validation changes:** Trigger a real workflow run and show the relevant event/output in the run history
3. **For new API endpoints:** Paste a `curl` command + response
4. **For metrics:** Show a `curl localhost:9090/metrics | grep <metric_name>` sample
5. **For extraction/transformation logic with no running service:** Write a script that fetches real upstream data (e.g. a third-party OpenAPI schema) and pipes it through the actual module — paste the script + its output

## Process

1. Read the git diff: `git diff origin/main...HEAD`
2. **Pick the form** — check the file list against the table above before writing anything. `git diff --name-only origin/main...HEAD` is usually enough to classify it.
3. Group changes by component/concern
4. Write Motivation — explain the business/engineering need
5. Write Implementation — 2–3 bullets; cut anything the diff already makes obvious. Skip for config-only.
6. Gather Proof of Work — run the workflow, capture output. **Skip the section entirely for docs-only and config-only**; do not replace it with a placeholder.
7. Decide on `## Verify on dev` — check the deploy-shaped list. Include it with commands, or omit the heading.
8. **Cut.** Word-count the draft; over ~600, remove rather than rewrite until it fits the budget table.
9. Format using `glab mr edit` or `glab mr create --description`

## Common Mistakes

| Mistake | Fix |
|---------|-----|
| Motivation describes what, not why | Start with the consequence of NOT having the change |
| Over-long Implementation narrating the diff | Cut to 2–3 bullets; the code is the spec, say only what isn't obvious |
| Reflexively adding `###` subsections | Default to a flat list; subsections only for genuinely distinct components |
| "Tests pass" or unit test results in Proof of Work | Capture actual runtime output or workflow run ID; never mention tests |
| Implementation is a file list | Describe behavior, not files |
| Missing entire sections | All three required — *unless* the diff is docs-only (no Proof of Work) or config-only (Motivation only). Check the form table first |
| No proof and no script, on a PR that runs something | Block merge — write a script if live invocation isn't possible, but never leave the section empty |
| A Proof of Work section reading "N/A", "docs only", or "✅ lint passes" | Delete the heading. An empty section is worse than an absent one — it implies evidence nobody gathered |
| Full structure on a docs-only PR | Classify the diff before drafting; a docs PR that narrates its own bullet list back as "proof" is the usual symptom |
| Short form on a PR that mixes docs and code | The short forms apply only when the excluded section would be genuinely empty, not when it's inconvenient to gather |
| A long description where every sentence is individually defensible | Length is the defect. Word-count it, cut to the budget table — a reviewer skims a wall and misses the load-bearing line |
| Re-arguing in prose what a code comment beside the change already says | One line and a pointer; the comment is the durable home for that reasoning |
| A paragraph per rejected alternative | One clause names the alternative and why not. More than that is a design doc |
| Bold lead-ins used as de-facto subsections to fit more in | That's the length budget being dodged. Consolidate into 2–3 bullets |
| Deploy-shaped change with no `## Verify on dev` | Add it — otherwise nobody, including the author next week, can tell what would count as the change working |
| `## Verify on dev` bullets like "verify metrics work" | Every bullet pairs an observable outcome with the command that observes it |
| `## Verify on dev` added to a change with no deployed risk | Delete the heading — it implies a verification nobody intends to run |

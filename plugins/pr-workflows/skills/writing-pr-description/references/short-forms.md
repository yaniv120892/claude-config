# Short forms

Read when the diff classified as docs-only, config-only, or a package bump. Each form below replaces the default four-section structure wholesale; do not mix them with it.

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

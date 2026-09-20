# Docs-only

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


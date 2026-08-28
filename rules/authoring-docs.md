---
paths:
  - "**/*.md"
  - "**/*.mdx"
description: How to write rule files, review checklists, and CLAUDE.md-style docs.
---

# Authoring Rules and Docs


**Rules and Docs State Invariants, Not a Census of Current Violations** — a list of what
currently violates a rule rots silently, and invites "my code matches the neighbour, so it's fine"
> Pattern: State the invariant, then point at the file to verify against. Note that pre-existing
> violations exist without enumerating them.
> Avoid: Bullet lists of which fields/files break the rule today.

**Positive Phrasing Over Prohibition** — a ban drags the forbidden behaviour into context and
makes it more available, not less
> Pattern: State the target behaviour ("write one-line comments") so the banned one is never
> spoken. When a hard guardrail must be stated as a prohibition, pair it with the positive
> target so attention lands on what to do.
> Avoid: Steering by "don't/never" lists.

**Delete No-Op Instructions** — a sentence the model already obeys by default pays context for
zero behaviour change
> Pattern: Test each line against "does this change behaviour vs. the default?"; when it fails,
> delete the whole sentence rather than trimming words. A word too weak to beat the default
> ("be thorough") gets a stronger word ("relentless"), not more sentences.
> Avoid: Keeping lines because they sound wise.

**Leading Words Over Restatement** — one compact concept the model already knows (tight, red,
seam, tracer bullet) anchors behaviour in fewer tokens than a sentence of description, and
repeats cheaply
> Pattern: Pick an existing term, define it once, then repeat it as a token everywhere the
> behaviour applies — in the doc body and in the pointer/description that triggers it.
> Avoid: Coining words that need paragraph-long definitions; spelling the same triad out at
> three sites.

**Don't Cache What the Environment Answers** — a doc line restating `package.json` scripts,
config values, or directory layout is a cache that goes stale; the lookup can't go stale
> Pattern: Document only what looking can't find — the unwritten convention, the why behind a
> choice, the gotcha no config confesses; point at the file for the rest.
> Avoid: Command lists and layout maps that duplicate one cheap lookup.

**Pointer Wording Decides Whether the Doc Gets Read** — a doc behind a weak pointer is a
variance bug: some runs reach it, some don't
> Pattern: Front-load the trigger word; state what the material is plus the distinct cases that
> should trigger reaching it, one trigger per case. Sharpen the pointer before inlining the
> material.
> Avoid: Synonym piles restating one trigger; identity the body already carries.

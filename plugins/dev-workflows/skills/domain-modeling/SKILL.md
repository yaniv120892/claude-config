---
name: domain-modeling
description: "Build and sharpen a project's domain model — a CONTEXT.md glossary of canonical terms and ADRs for hard-to-reverse decisions. Use when discussing codebase terminology, naming a new module or concept, writing or editing a CONTEXT.md, or recording an architecture decision."
---

# Domain Modeling

Actively build and sharpen the project's domain model as you design. This is the *active* discipline: challenging terms, inventing edge-case scenarios, and writing the glossary and decisions down the moment they crystallize. Merely *reading* `CONTEXT.md` for vocabulary is not this skill — that is a one-line habit any task can do. Use this skill when you are changing the model, not just consuming it.

## File structure

Most repos have a single context:

```
/
├── CONTEXT.md
├── docs/
│   └── adr/
│       ├── 0001-event-sourced-orders.md
│       └── 0002-postgres-for-write-model.md
└── src/
```

If a `CONTEXT-MAP.md` exists at the root, the repo has multiple contexts. The map points at per-context `CONTEXT.md` files (e.g. `src/ordering/CONTEXT.md`, each with its own `docs/adr/` for context-specific decisions; root `docs/adr/` holds system-wide ones).

Create files lazily — only when there is something to write. No `CONTEXT.md` yet? Create it when the first term resolves. No `docs/adr/`? Create it when the first ADR is needed.

## During the session

**Challenge terms against the glossary.** When the user uses a term that conflicts with `CONTEXT.md`, call it out immediately: "Your glossary defines 'cancellation' as X, but you seem to mean Y. Which is it?"

**Sharpen fuzzy language.** When a term is vague or overloaded, propose one precise canonical term with explicit *Avoid:* synonyms: "You're saying 'account' — do you mean the Customer or the User? Those are different things."

**Stress-test with concrete scenarios.** When domain relationships come up, invent edge-case scenarios that force precision about the boundaries between concepts.

**Cross-reference with code.** When the user states how something works, check whether the code agrees. Surface contradictions: "Your code cancels entire Orders, but you just said partial cancellation is possible. Which is right?"

**Update CONTEXT.md inline.** The moment a term resolves, write it into `CONTEXT.md` — never batch. Use the format in [CONTEXT-FORMAT.md](./CONTEXT-FORMAT.md).

`CONTEXT.md` is a glossary and nothing else: no implementation details, no spec content, no scratch notes.

## ADR gate

Offer an ADR only when **all three** hold:

1. **Hard to reverse** — changing your mind later costs something real
2. **Surprising without context** — a future reader will wonder "why did they do it this way?"
3. **The result of a real trade-off** — there were genuine alternatives and one was picked for specific reasons

If any is missing, skip the ADR. Use the format in [ADR-FORMAT.md](./ADR-FORMAT.md).

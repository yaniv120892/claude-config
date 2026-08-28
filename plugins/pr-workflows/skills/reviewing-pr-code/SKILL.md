---
name: reviewing-pr-code
description: Use when reviewing pull requests, merge requests, diffs, or code changes in TypeScript, Express backend services, or Next.js frontend apps for correctness, maintainability, standards, security, performance, tests, and unintended side effects.
---

# Reviewing PR Code

## Delegate to a Sonnet subagent

**Do not review inline.** This is a well-specified checklist task — it doesn't need this session's model tier, and reviewing inline means paying to reprocess this session's full accumulated context (prior file reads, diffs, tool output) at whatever cost that carries, often on a more expensive model than the task needs.

**Anti-recursion guard:** if your own task prompt already identifies you as the dispatched reviewing-pr-code subagent, skip this section and go straight to **Review Contract** below.

Otherwise, spawn a subagent to do the actual review:

```
Agent({
  description: "Review PR code",
  model: "sonnet",
  run_in_background: false,
  prompt: "You are the reviewing-pr-code subagent for <repo absolute path>.
    Invoke the reviewing-pr-code skill yourself and follow it directly — you are the
    dispatched subagent, so do not delegate further. Review the diff: <diff scope, e.g.
    'git diff origin/main...HEAD' or the specific PR/files already identified in this
    conversation>. Return the full checklist output exactly as the skill specifies."
})
```

Fill in the repo path and diff scope from what you already know. Present the subagent's checklist output to the user exactly as returned.

## Review Contract

Review as a senior engineer. Prioritize defects, risk, regressions, missing tests, and violations of project standards. Use a checklist format by default, but lead with blocking findings when they exist.

Always read the repository instructions first: `AGENTS.md`, `CLAUDE.md`, `.codex/rules/`, `.claude/rules/`, package scripts, lint/type/test config, and the touched files' nearby patterns.

On top of repo rules and the stack checklists, always apply the generic smell baseline in `references/code-smells.md` — it holds regardless of stack or repo. Baseline findings are judgement calls, never hard violations: report them as suggestions, distinct from rule violations, and let any documented repo standard override them.

## Workflow

1. Identify the diff scope, touched modules, public contracts, data flows, and likely blast radius.
2. Determine project type:
   - Express or backend API: also read `references/express-backend-review.md`.
   - Next.js or React frontend: also read `references/nextjs-frontend-review.md`.
   - Any stack: read `references/code-smells.md` for the always-on smell baseline.
3. Run or request lint. Do not run or request build/test/typecheck — CI already gates those on every PR. Spend that effort reading the actual logic instead.
4. Review for issues first, then style. Do not spend review attention on harmless preferences when correctness or risk is unresolved.
5. Produce the checklist output below. Mark an item `N/A` only when it is genuinely irrelevant to the diff.

## Output Format

Use this structure:

```markdown
**Verdict**
Pass | Pass With Notes | Changes Requested

**Blocking Findings**
- [severity] file:line - Issue, impact, and concrete fix.

**Checklist**
- Correctness: Pass/Fail/N/A - ...
- Types: Pass/Fail/N/A - ...
- Naming/readability: Pass/Fail/N/A - ...
- Architecture: Pass/Fail/N/A - ...
- Security: Pass/Fail/N/A - ...
- Performance: Pass/Fail/N/A - ...
- Tests: Pass/Fail/N/A - ...
- Blast radius: Pass/Fail/N/A - ...
- Framework-specific: Pass/Fail/N/A - ...

**Questions**
- ...

**Verification**
- Lint: command/result.
- Not run: build/test are covered by CI, not the review.
```

If there are no blocking findings, say so explicitly. Every finding needs a file/line reference when available.

## Review Standards

- Prefer meaningful names for variables, functions, files, and types. Names should explain domain intent, not implementation mechanics.
- Prefer self-documenting code over comments. Comments are acceptable only when naming or decomposition cannot make complex reasoning clear.
- Check that types are precise, exported types live in dedicated type files when shared, and internal types sit near the top of the file before logic.
- Use `T[]` instead of `Array<T>`.
- Avoid `Pick<T, "field">` for fixed selections of one to three fields; inline the shape or create a named type.
- Require explicit `public`, `private`, or `protected` modifiers on TypeScript class members.
- Prefer public/exported methods before private helpers.
- Always use braces for control flow.
- Fix lint issues instead of suppressing them. Treat new `eslint-disable` comments as findings unless the diff proves no practical alternative exists.
- Avoid broad refactors, public contract changes, or behavior changes outside the PR's stated intent.

## Package Reuse

When code reimplements common behavior, suggest a package only when it is well-known, actively maintained, secure enough for the context, or comes from your organisation's internal registry. Prefer an established ecosystem library, or a shared internal package that already solves the problem, over a hand-rolled reimplementation.

Do not silently choose or add a dependency. Ask: "Should we use `<package>` for this, or keep the local implementation?"

Review package proposals for bundle/runtime cost, license/security posture, maintenance activity, tree-shaking, transitive dependencies, and whether the package is already used in the repo.

## Backend Endpoint Profiling

When API behavior, query shape, pagination, filtering, response contract, or endpoint ownership changes, always ask:

- How often is this endpoint expected to be called?
- How much data can it read, scan, transform, and return per call?
- What are the expected p50/p95 payload sizes and latency expectations if known?
- Is the endpoint user-facing, internal, batch-driven, webhook-driven, or admin-only?

Maintain a project-local file at `.codex/review-endpoint-profile.md`. Create it if missing. Append or update rows based on the user's answers:

```markdown
| Endpoint | Method | Caller/Use case | Expected frequency | Data volume | Notes | Last updated |
| --- | --- | --- | --- | --- | --- | --- |
```

Use this profile during future reviews in the same project. If the file conflicts with new user answers, update it and mention the change.

## Common Gaps To Catch

- Runtime validation missing at API, form, queue, webhook, or external-service boundaries.
- Type assertions hiding uncertain data instead of narrowing or validating it.
- Changes that alter shared DTOs, generated models, or exported types without checking consumers.
- **Edits to a shared resolver, mapper, formatter, or classifier that change output for every caller, not just the one the PR is about.** A PR scoped to one provider/feature can quietly re-map every other one through a function they all share. Establish the full caller set before accepting a change to such a function, and say so in the finding.
- **Emitted identifiers whose *value* is renamed rather than added** — metric label values, log field values, event names, enum strings crossing a process boundary. Nothing fails to compile and no error surfaces at runtime; the consumer (dashboard, alert rule, downstream query) just silently stops matching after deploy. Treat renaming an existing series as a breaking change needing its own migration, separate from the feature PR.
- Missing error, empty, loading, timeout, retry, or cancellation paths.
- Query or loop behavior that scales with total table size, artifact count, user history, or unbounded input.
- New behavior without tests around edge cases, failure paths, and compatibility.
- Naming that exposes "how" but not "why".

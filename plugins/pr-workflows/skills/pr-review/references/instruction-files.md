# Instruction-File Scope Check

Run only when the diff touches `CLAUDE.md`, `AGENTS.md`, or a `.claude/rules/*.md`
file. Otherwise skip it and write nothing.

`CLAUDE.md` loads into every session in the repo, so each line pays for itself on
every prompt. A section that matters only for one kind of task belongs where it
loads for that task and costs nothing otherwise.

## What to look at

Only what the diff **adds or grows** — a new section, a table, a runbook, a list
that gained rows. Do not audit the rest of the file; content the diff does not
touch is not a finding, even if it would also move.

## The test

For each added or grown block, name the task or file that makes a reader need it.

| It is needed when… | Destination |
|---|---|
| editing files matching a path or glob (`package.json`, `src/tracing/**`) | `.claude/rules/<name>.md` with a `paths:` list |
| invoking a workflow ("add a tenant", "deploy") | a skill — its body costs nothing until used |
| looking something up (long reference, history, a runbook) | a doc under `docs/`, with a one-line pointer in `CLAUDE.md` |
| nearly every task (build/test commands, repo map, conventions, behavior contract) | stays in `CLAUDE.md` |

If you cannot name the task or file, leave it. A guess is noise.

Typical movers: dependency-pin tables, per-tenant or per-domain notes, API
examples, long gotcha lists tied to a path, one-off runbooks.

## Also flag

- A new `.claude/rules/*.md` with no `paths:` frontmatter. It loads into every
  session at the same priority as `CLAUDE.md` (shared-rules.md: "Scope a repo's
  rule files with `paths:` frontmatter").
- A pointer left behind that no longer matches the moved content.

## Output

One row per block, into section B of the review (rule = `Scope instruction files`):

| rule | file:line | comment |
|---|---|---|
| Scope instruction files | CLAUDE.md:477 | 17-line pinned-dependency table is needed only when editing `package.json`. Move it to `.claude/rules/pinned-dependencies.md` with `paths: ['package.json']` and leave a one-line pointer. |

Comment contract applies: two sentences, the destination and the trigger, no
preamble. Severity is LOW — this never blocks a merge.

# Instruction-File Check

Checks that the agent-facing markdown a PR adds or changes will load when it is
needed, and only then. Files in scope:

- `CLAUDE.md` and `AGENTS.md` at any depth
- `.claude/rules/**/*.md`
- `SKILL.md` and the files under a skill's `references/`
- `.claude/agents/*.md`
- `.claude/commands/*.md`

Each of these has a loading cost. `CLAUDE.md` and unscoped rules load into every
session. A rule loads when a file its `paths:` matches is read. A skill's
`description` is in every session, but its body loads only when the skill is
invoked, and a `references/` file only when the body tells the agent to read it.
A line in the wrong place is either paid for on every prompt or never seen.

## What to look at

Only what the diff **adds or changes**. Content the diff does not touch is not a
finding, even if it would also move.

Work from the local clone when the prompt gives one. Otherwise read file lists
with `gh api repos/<slug>/git/trees/<head-sha>?recursive=1`.

## 1. Placement

For each added or grown block, name the task or file that makes a reader need it.

| It is needed when… | Destination |
|---|---|
| editing files matching a path or glob (`package.json`, `src/tracing/**`) | `.claude/rules/<name>.md` with a `paths:` list |
| invoking a workflow ("add a tenant", "deploy") | a skill — its body costs nothing until used |
| a skill is running, but only for one branch of it | that skill's `references/<topic>.md`, named from the body at the point it applies |
| looking something up (long reference, history, a runbook) | a doc under `docs/`, with a one-line pointer in `CLAUDE.md` |
| nearly every task (build/test commands, repo map, conventions, behavior contract) | stays in `CLAUDE.md` |

If you cannot name the task or file, leave it. A guess is noise.

Typical movers: dependency-pin tables, per-tenant or per-domain notes, API
examples, long gotcha lists tied to a path, one-off runbooks, a skill body that
carries every branch's detail inline.

## 2. Loading actually happens

- **Every `paths:` glob matches at least one file at the head SHA.** Run
  `git ls-files '<glob>'` (or filter the tree listing) for each entry. A glob
  that matches nothing means the rule never loads, and nothing reports it.
- **A glob is not wider than the rule's content.** A rule about migrations
  scoped to `src/**` loads on every source read.
- **A new `.claude/rules/*.md` has `paths:` frontmatter.** Without it, it loads
  into every session at the same priority as `CLAUDE.md` (shared-rules.md:
  "Scope a repo's rule files with `paths:` frontmatter").
- **Every pointer resolves.** A path, file name or `→ Section` heading named in
  added text exists at the head SHA. Content moved by the diff leaves no pointer
  to its old location, in this repo or in files the diff also touched. A stale
  pointer in a file that must not be edited (an applied, checksummed migration;
  a vendored file) is fine when the new location says what the old citation
  now means.

## 3. Skills, agents and commands

- **The `description` says when to use it**: the request phrasings or symptoms
  that should trigger it, and what it is not for when a sibling skill is close.
  A description that only summarizes what the skill does never gets matched.
- **The body tells the agent which file to read and when**, by path. A
  `references/` file nothing in the body names is never loaded.
- **Rule files are passed by path, not inlined** into a subagent prompt or args
  (shared-rules.md: "Pass Rule-File Paths to Subagents, Never Inlined Contents").
- **A subagent prompt names the repo it works in** and tells the agent to read
  that repo's `CLAUDE.md` first (shared-rules.md: "Run Subagents From the Repo
  They Modify").

## Output

One row per finding, nothing else. Write `None` when there are none.

````markdown
### Instruction files — <owner/repo>#<n>
| severity | check | file:line | comment |
| LOW | Placement | CLAUDE.md:477 | 17-line pinned-dependency table is needed only when editing `package.json`. Move it to `.claude/rules/pinned-dependencies.md` with `paths: ['package.json']` and leave a one-line pointer. |
| MEDIUM | Glob matches nothing | .claude/rules/queries.md:3 | `src/domain/**` matches no file (the directory is `src/domains/`), so this rule never loads. Fix the glob. |
````

The comment contract in `rubric.md` applies: two sentences, the consequence
first, then the fix. Severity is LOW, except a glob that matches nothing or a
pointer that does not resolve, which is MEDIUM: those silently drop guidance
the author believes is live.

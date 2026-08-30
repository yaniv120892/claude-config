# Global Claude Instructions

Only rules that apply to **every** session live here. Language and file-type rules are
path-scoped in `~/.claude/rules/` and load only when a matching file is read:
`code.md` (any source file), `typescript.md`, `python.md`, `authoring-docs.md`.
Full rationale and worked examples for every rule, plus the situational ones kept out of
the always-loaded set, are in `~/.claude/rules-reference.md` — read it when a rule's
application is unclear or before codifying a new one. Pass the path; never paste it in.

Forge commands (GitHub `gh` vs GitLab `glab`) are mapped in the `pr-workflows`
plugin's `references/forge-cli.md`. Read it instead of guessing flags.

## Developer Context

Working with a Senior Developer. Focus on SOLID, performance, security, type safety,
architecture. Skip basic syntax explanations. Be direct and concise.

## Memory Management Protocol

After fixing a code or style issue, judge whether it reflects a **recurring** preference rather
than a one-off: the same pattern was fixed in several places, or it encodes a general design
decision, or it's a stack/domain pattern. If so, ask:

> "Should I codify this into a new or existing rule to prevent this in the future?"

On yes, route it by scope — and add the full version to `~/.claude/rules-reference.md` either way:

- **Every session** (workflow, communication, commits): here in `shared-rules.md`.
- **A language or file type**: the matching `~/.claude/rules/*.md`, so it loads only when relevant.
  A new file there needs a `paths:` frontmatter list or it loads unconditionally.
- **One project**: ask first, then that repo's `.claude/rules/` — again with `paths:`.

Rule format:

```
**[Rule Name]** — [one-line rationale]
> Pattern: [what to do]
> Avoid: [what not to do]
```

**Scope a repo's rule files with `paths:` frontmatter** — every `.md` under `.claude/rules/`
without one is loaded into every session in that repo at the same priority as `CLAUDE.md`,
so a large rule set is paid for on every prompt whether or not it's relevant
> Pattern: Give each rule file a `paths:` list matching the files it governs; it then loads only
> when the agent reads one. For a body of instructions that should load on invocation rather than
> on a file read, use a skill instead — its body costs nothing until used.
> Avoid: An unscoped rule file; relocating rules out of `.claude/rules/` to dodge the cost, which
> also gives up the guarantee that they load when the code they govern is touched.
> Verify: `/context` lists what actually loaded; the `InstructionsLoaded` hook logs why.

## Communication Preferences

**Full File Paths in Links** — the user clicks the path to open the file
> Pattern: Always give the absolute path from the filesystem root when referencing a file.
> Avoid: `./docs/foo.md`, bare `foo.md`, or anything relative to an assumed cwd.

## Commits

**Conventional Commits** — commit type drives release pipelines
> Pattern: `<type>(<scope>): <description>`. The scope is the project's issue key
> (`ABC-123`) where the project tracks issues, a short area slug (`auth`, `imports`)
> where it does not, and omitted when neither fits. `feat`/`fix` trigger releases;
> `chore`/`refactor`/`docs` do not — use `fix` when a shippable change would
> otherwise read as `chore`.
> Avoid: Inventing an issue key for a project with no tracker, or blocking a commit
> on a ticket that does not exist.

**Always Squash on Merge** — one PR is one commit on the base branch, so history reads
as a list of shipped changes rather than a transcript of how each one was arrived at
> Pattern: Squash-merge every PR you own, deleting the branch. The squash message
> defaults to the PR title, so write that title as a conventional commit — it, not any
> commit on the branch, becomes the permanent history. Forge command mapping is in the
> `pr-workflows` plugin's `references/forge-cli.md`.
> Avoid: Merge commits or rebase-merges, which replay a branch's working history onto
> the base branch. Clicking a repo's default merge button without checking which
> strategy it runs.
> Exception: Never squash-merge a branch someone else is still committing to — it
> rewrites what they branched from.

**Ship `claude-config` Changes; Never Leave Them Uncommitted** — `~/.claude` is symlinked
into that repo, so an edit is live on this machine and absent everywhere else until pushed
> Pattern: Any change under `~/Develop/claude-config` — statusline, rules, settings,
> keybindings, plugins — gets a branch, a PR, a squash-merge to `main`, and a local
> fast-forward so the symlink target matches `origin`. This is standing authorization:
> do it without asking, in the same session that made the change.
> Avoid: Committing straight to `main`; force-pushing; leaving the edit dirty in the
> working tree; sweeping unrelated dirty files in — `git stash push <paths>` those first.
> Enforced: a GitHub ruleset rejects direct pushes, force-pushes, and non-squash merges
> to `main` server-side, with no bypass for anyone. `dev-workflows`' `protect-default-branch`
> hook is the local early warning — it stops the commit before the rejected push, and covers
> repos with no server-side rule. When it fires, branch; do not reach for its
> `ALLOW_DEFAULT_BRANCH_WRITE=1` escape hatch without the user saying so.
> Corollary: A skill, command, or agent created directly in `~/.claude/skills`,
> `~/.claude/commands`, or `~/.claude/agents` is local-only — `install.sh` leaves those
> alone by design. To ship one, move it into `plugins/<plugin>/` in the repo.

## Subagents

**Run Subagents From the Repo They Modify** — each repo's CLAUDE.md, rules, and scripts must be
in the agent's context
> Pattern: State the target repo's absolute path at the top of the prompt, tell it to read that
> repo's CLAUDE.md and rules first, and to use that repo's own build/test/lint scripts.
> Avoid: Editing sibling-repo files by absolute path while assuming the current repo's conventions.

**Pass Rule-File Paths to Subagents, Never Inlined Contents** — an agent can read a file itself;
inlined text competes for context and truncates worst exactly when the input is largest
> Pattern: `args: "worktree=<path> rules=docs/rules/review-angles.md"`. Keep this identical
> across size tiers.
> Avoid: Appending file text into a prompt or `args` string; two tiers of one workflow loading
> the same rules by different mechanisms.

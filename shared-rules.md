# Global Claude Instructions

Only rules that apply to **every** session live here. Language and file-type rules are
path-scoped in `~/.claude/rules/` and load only when a matching file is read:
`code.md` (any source file), `typescript.md`, `python.md`, `authoring-docs.md`, `config.md`,
`tooling.md` (lint, format, tsconfig, CI and observability setup — the shared packages),
`migrations.md` (schema migrations).
Full rationale and worked examples for every rule, plus the situational ones kept out of
the always-loaded set, are in `~/.claude/rules-reference.md` — read it when a rule's
application is unclear or before codifying a new one. Pass the path; never paste it in.

Pull request work goes through `gh`; the `pr-workflows` plugin owns those skills
and its `lib/github.py` owns the API plumbing.

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
without one is loaded into every session in that repo at the same priority as `AGENTS.md`,
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

**Slack Messages: the Ask First, at Most Three Lines** — teammates read DMs on a phone between tasks; a long message buries what you need from them
> Pattern: Line 1 is the ask (what you need them to do), then one line of why, then links. A PR review ack is the single word "replied" in the request thread. Detail stays in chat with the user; draft first and wait for approval unless a skill says otherwise.
> Avoid: Context before the ask, investigation narrative, "tell me when it's done and I'll check it", a fresh top-level DM where a thread already holds the context.

**Use the cmux Browser** — the user's cmux browser is already logged in to GitHub, Linear, PostHog, the back office and ChatGPT
> Pattern: Inside cmux (`$CMUX_WORKSPACE_ID` set), open every PR, ticket or page you point the user to as a browser tab in the current workspace (`cmux new-surface --type browser --url <url>`), and check UI, consoles and dashboards there yourself. A new PR opens automatically (cmux plugin hook).
> Avoid: Playwright, Chrome automation, or asking the user for a screenshot when the cmux browser can reach the page; reporting a screen "unverified, no credentials" before trying the cmux browser and asking the user to log in there.

## Verification

**Proof of Work Is Not Regression Coverage** — a throwaway script proves the change worked once,
on the branch that shipped it; the next person to touch the call site reverts the behaviour and
every committed test still passes
> Pattern: Any behaviour a reviewer could silently undo — a new branch, filter, assertion or
> guard, a per-call override, a non-default argument — ships with a committed spec that exercises
> the real code path and asserts that behaviour, including the negative and empty-state case.
> Verify it bites: delete or invert the line locally, watch a named spec fail, restore.
> Avoid: A PoW script written, run, pasted into the change request, and deleted; a test that only
> covers the shared default the override deviates from; assertions on values no fixture contains.
> Not behaviour: CSS/Tailwind classes, layout and copy text get a screenshot or GIF in the Proof
> of Work, not a committed test. A capability is tested once with one representative config; a
> per-tenant case only when that tenant's config takes a different code path.

**Proof of Work Runs on the Final Head, and Matches the Change's Kind** — every later commit
voids earlier runs, and a fixture the validator accepts says nothing about what the model does
> Pattern: Before marking ready, re-run the repo's required verification (its `AGENTS.md`
> "before ready" steps, evals) on `git rev-parse HEAD` and name that SHA in the Proof of Work.
> A prompt, skill-description or tool-description change gets a before/after model run on the
> text the host actually sees.
> Avoid: Proof of Work naming an earlier SHA; a mocked `generateText` spec offered as evidence
> that the model follows a new instruction.

**A Ticket Reaches Done on Production Evidence, Posted as a Comment** — merged and deployed
says the code shipped, not that the problem is gone; the ticket is where the next reader checks
> Pattern: Before moving a ticket to Done, post a comment on it with production evidence that the
> problem is solved: the log lines, product events or live check, with times. Prefer the app's own
> telemetry (Better Stack, PostHog) over a person reporting back. When the evidence needs time (a
> nightly job, a rare event), keep the ticket In Progress with a comment naming the evidence that
> will close it, and schedule the check.
> Avoid: Done on merge or on a green deploy; evidence only in the PR or the chat.

## GitHub Quota

**Poll GitHub at 30 Seconds or Slower** — the 5,000/hr quota is shared by every session, agent
and mod on the machine, and `gh run watch` defaults to a 3 s refresh, so two watchers drain it
> Pattern: `gh run watch <id> --interval 30 --compact --exit-status`; `gh pr checks <n> --watch
> --interval 30`; a hand-written loop sleeps 30 s or more. On a rate-limit error, read the reset
> time from `gh api rate_limit` (free) and wait for it once.
> Avoid: A bare `--watch`; retrying a rate-limited call; one watcher per subagent for the same PR.

## Killing Processes

**Options Before the Pattern in `pkill`/`pgrep`** — macOS's BSD `pkill` stops reading options at
the first pattern, so a trailing `-n` becomes a second pattern that matches every cmux pane's
`login … --noprofile` and kills all sessions at once (2026-11-26)
> Pattern: `pkill -n -f "<specific pattern>"`, all flags first; preview with the same `pgrep -fl`
> first; prefer `kill <pid>` from `$!` or `lsof -t -i :<port>`.
> Avoid: Any argument after the pattern; `2>/dev/null` on a `pkill`, which hides the mistake;
> a pattern as broad as `claude`, `node` or `zsh`.

## Commits

**Conventional Commits** — commit type drives release pipelines
> Pattern: `<type>(<scope>): <description>`. The scope is the project's issue key
> (`ABC-123`) where the project tracks issues, a short area slug (`auth`, `imports`)
> where it does not, and omitted when neither fits. `feat`/`fix` trigger releases;
> `chore`/`refactor`/`docs` do not — use `fix` when a shippable change would
> otherwise read as `chore`.
> Avoid: Inventing an issue key for a project with no tracker, or blocking a commit
> on a ticket that does not exist.

**PR Title Is `<KEY> - <repo> - <description>`** — the squash commit takes the PR title, and the
team's merged PRs read this way
> Pattern: `RDBAZ-1526 - dal - back office shows business contacts and images that a tool
> returned`. The key is the project's issue key, the repo is the short name of the repo the PR
> lands in (`dal`, `mastra`, `gw-api`, `frontend`), and the description says what changed. A
> project with no tracker drops the key: `<repo> - <description>`. Commits on the branch stay
> Conventional Commits.
> Avoid: `fix(RDBAZ-1526): …` as a PR title.
> Exception: a repo whose release pipeline reads the type from the squash title keeps the
> conventional title; check the repo's workflows before assuming.

**Always Squash on Merge** — one PR is one commit on the base branch, so history reads
as a list of shipped changes rather than a transcript of how each one was arrived at
> Pattern: Squash-merge every PR you own, deleting the branch. The squash message
> defaults to the PR title, so write that title in the PR title format above — it, not any
> commit on the branch, becomes the permanent history.
> Avoid: Merge commits or rebase-merges, which replay a branch's working history onto
> the base branch. Clicking a repo's default merge button without checking which
> strategy it runs.
> Exception: Never squash-merge a branch someone else is still committing to — it
> rewrites what they branched from.

**Ship `claude-config` Changes; Never Leave Them Uncommitted** — `~/.claude` is symlinked
into that repo, so an edit is live on this machine and absent everywhere else until pushed
> Pattern: Any change under the `claude-config` checkout — rules, settings, keybindings,
> plugins — gets a branch, a PR, a squash-merge to `main`, and a local fast-forward so the
> symlink target matches `origin`. This is standing authorization: do it without asking, in
> the same session that made the change. `readlink ~/.claude/shared-rules.md` names the
> checkout. It must never be `~/.claude/plugins/marketplaces/<name>`: `claude plugin
> marketplace update` replaces that clone wholesale, so every symlink into it dangles and
> the hooks they point at silently stop running.
> Corollary: if a file under `~/.claude` is a regular file where `install.sh` links one, the
> symlink was clobbered and the two have drifted — reconcile before editing either.
> Avoid: Committing straight to `main`; force-pushing; leaving the edit dirty in the
> working tree; sweeping unrelated dirty files in — `git stash push <paths>` those first.
> Enforced: a GitHub ruleset rejects direct pushes, force-pushes, and non-squash merges
> to `main` server-side, with no bypass for anyone. The `mods` default-branch
> guard is the local early warning — it stops the commit before the rejected push, and covers
> repos with no server-side rule. When it fires, branch; do not reach for its
> `ALLOW_DEFAULT_BRANCH_WRITE=1` escape hatch without the user saying so.
> Corollary: A skill, command, or agent created directly in `~/.claude/skills`,
> `~/.claude/commands`, or `~/.claude/agents` is local-only — `install.sh` leaves those
> alone by design. To ship one, move it into `plugins/<plugin>/` in the repo.

## Subagents

**Run Subagents From the Repo They Modify** — each repo's AGENTS.md, rules, and scripts must be
in the agent's context
> Pattern: State the target repo's absolute path at the top of the prompt, tell it to read that
> repo's AGENTS.md (or CLAUDE.md) and rules first, and to use that repo's own build/test/lint scripts.
> Avoid: Editing sibling-repo files by absolute path while assuming the current repo's conventions.

**Pass Rule-File Paths to Subagents, Never Inlined Contents** — an agent can read a file itself;
inlined text competes for context and truncates worst exactly when the input is largest
> Pattern: `args: "worktree=<path> rules=docs/rules/review-angles.md"`. Keep this identical
> across size tiers.
> Avoid: Appending file text into a prompt or `args` string; two tiers of one workflow loading
> the same rules by different mechanisms.

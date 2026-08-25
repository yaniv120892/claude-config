# Brainstorming Questions: session/PR/task visualization tool ("shipboard")

Please answer each question below (replace the `>` placeholder, or answer by
number in chat) and let me know when done.

Context I'm working from: every `/ship` run already persists rich state on disk
in its worktree — `.claude/ship/state.json` (phase pointer, branch, PR, request),
`scope.md`, `plan.md`, `proof-of-work.md`, `reports/<phase>.md` — so a local
dashboard can be built by *discovering and rendering* that state without
touching the pipeline. The open questions are about everything around that.

---

## 1. What appears on the board?

**Options (pick one, or combine):**
- A: Only `/ship` runs — the board is a /ship pipeline monitor
- B: A + any open PR authored by you, even when it didn't come from /ship
- C: B + your assigned Linear/issue-tracker tasks that aren't linked to any run yet (shows work that *hasn't started*)
- D: C + plain Claude sessions with no ship state and no PR (best-effort, low detail)

> 

---

## 2. What should happen with flows that do NOT go through /ship?

This is your question back to you — there are three real strategies:

**Options:**
- A: Out of scope. The board only shows /ship runs; other work simply doesn't appear.
- B: Ambient detection — show best-effort cards derived from signals that already exist: non-default git branches in your worktrees, open PRs (`gh`), recently-active local Claude sessions (`~/.claude/projects/*` transcript mtimes). Less detail (no phase, no plan doc), but nothing is invisible.
- C: Opt-in registration — extend your other skills (`creating-prs`, `executing-plans`, `subagent-driven-development`) to write a small shared `state.json` in the same shape, so any flow can appear as a first-class card over time.

My lean: B now, C as a later increment. What's yours?

> 

---

## 3. Where does your work actually run?

- Local machine only, or do you also run claude.ai/code **remote** sessions that should appear on the board?
- If remote sessions matter: is a link-out (e.g. a card that opens claude.ai/code) enough, or do you need live status? (Live status is the one thing without a clean local data source.)

> 

---

## 4. Issue tracker: Linear or Jira?

Your `issue-tracker` plugin config is Jira-shaped, but you said "linear task" and this session has Linear MCP.

**Options:**
- A: Linear — and I want task status shown on the board (needs a `LINEAR_API_KEY` read by the local tool)
- B: Linear — links only (branch name `ABC-123` → linear.app URL), no API
- C: Jira (same two sub-options)
- D: Both/depends (work vs personal profile)

If A/B: what's your Linear workspace slug?

> 

---

## 5. Where should the tool look for runs?

Which root directories hold your repos/worktrees (e.g. `~/Develop`)? Do worktrees ever live outside the repo's `.worktrees/` dir (cmux-managed paths, harness-native worktree locations)? List anything the scanner must cover.

> 

---

## 6. UI form factor

**Options:**
- A: Local web app — `shipboard` starts a localhost server, opens a browser tab, auto-refreshes (my recommendation: easiest to make genuinely pleasant, renders markdown docs well)
- B: Terminal TUI
- C: A cmux surface (you already have cmux-browser/cmux-workspace skills)
- D: macOS menu-bar app

> 

---

## 7. Board layout (visual)

**Options:**
- A: Kanban — columns are pipeline stages (Scoping → Planning → Implementing → Polish → QA → Ready to merge → Merged/Verified), cards move left→right; human-gate columns highlighted
- B: Card grid — one card per flow sorted by recency, each card carrying a mini pipeline-progress strip
- C: Dense table — one row per flow; best if you expect many parallel flows

Once I have your answers I can mock up the top 2 options visually (as a shareable artifact page) before we commit — want that?

> 

---

## 8. What does the detail view need?

When you click a flow, what matters most? Rank or strike out:

- Rendered `plan.md` / `scope.md` / `proof-of-work.md`
- Per-phase reports (`reports/*.md`) — the "where did it go wrong" trail
- QA verdict, surfaced verbatim
- Git: branch, ahead/behind base, last commits, dirty files
- PR: CI checks, review decision, mergeable state
- The original request, verbatim (what the run is judged against)

> 

---

## 9. Actions from the UI — read-only or buttons?

**Options (multi-select):**
- A: Strictly read-only observer
- B: Open helpers — open doc rendered in the browser, open worktree/file in Cursor, open PR / Linear links, copy `/ship resume` or `gh pr merge` command to clipboard
- C: Real actions — e.g. archive/dismiss a card, mark a run abandoned
- D: Launch actions — e.g. start `/ship resume` in a terminal/cmux from the board

My lean: B (+C only as local bookkeeping, never touching run state).

> 

---

## 10. History after merge

Your `post-merge-cleanup` hook deletes the worktree once a PR merges — so a run's entire story (plan, reports, QA verdict) disappears at exactly the moment you might want the retrospective.

**Options:**
- A: Archive — shipboard snapshots each run's `.claude/ship/` into `~/.claude/shipboard/history/` while the run is live, so merged/verified runs stay reviewable (my recommendation)
- B: Live-only — the board shows current work; history is git log + closed PRs
- C: Archive, but also keep a "recently shipped" section on the board fed from it

> 

---

## 11. Per-phase timestamps — OK to touch /ship?

`state.json`'s `history` entries are freeform lines with no timestamps. Two ways to get a real timeline:

**Options:**
- A: Tiny /ship skill change — history entries become `{phase, at}` stamps (one-line change to the conductor instructions; my recommendation)
- B: Don't touch /ship — approximate the timeline from file mtimes (works, but mtimes get clobbered by e.g. re-writes)

> 

---

## 12. Notifications at human gates?

The gates where a run sits waiting for *you*: scoping answers, plan approval, ready-to-merge.

**Options:**
- A: Passive — the board highlights "needs you" cards, nothing pushes
- B: Desktop notification when a run *enters* a needs-you state (you have cmux-notify; or terminal-notifier)
- C: B, but only for ready-to-merge

> 

---

## 13. The new repo & stack

- Repo name: `shipboard`? (alternatives: `flightdeck`, `conductor-board`, your call) — public or private?
- Stack: my recommendation is zero-dependency Node (single `server.js` + one HTML page, `npx`-runnable, nothing to build or update). Alternative: Vite+React if you'd rather have a component framework for a richer UI. Preference?

> 

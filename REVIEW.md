# Config review — what was kept, generalized, and dropped

A pass over the whole Claude Code setup while extracting it into this repo:
45 unique skills across two profiles, 4 rule files, 3 slash commands, 2 settings
files, 1 hook, 1 MCP server.

Both profiles (`~/.claude` and `~/.claude-personal`) held byte-identical copies of
every shared skill, so the union — not the sum — is what mattered: **45 unique
skills in, 29 out.**

---

## Dropped (17)

Irreducibly employer-specific: they encode one company's internal APIs, AWS
accounts, repo names, or deploy topology, and there is no generic skill hiding
inside them.

| Skill | Why |
| --- | --- |
| `cms-api` | One company's internal content API and artifact-key format |
| `login-asset-management-admin` | One app's Cognito SSO dev-login dance |
| `provision-ssm-parameters` | Named AWS accounts, KMS keys, `/content/{env}/` path convention |
| `verify-model-mapping` | A specific AI-model config schema (three-layer uiConfig/internalConfig/mapConfig) |
| `toolkit-generation-request-info` | Internal chat-sessions HTTP API |
| `investigate-generation` | Same generation pipeline |
| `convertor-debug` | One convertor pipeline, dev environment only |
| `workflow-config-explorer` | `GenerationWorkflowConfig` data model |
| `temporal-patch-deprecation` | Hardcoded repo path, one team's Temporal patch lifecycle |
| `add-helm-env-var` | Named helm registries and gitops repos |
| `capturing-admin-proof-of-work` | One admin app's boot/login/screenshot sequence |
| `add-error-code` | A 5-repo error-code propagation specific to one pipeline |
| `create-jira-ticket` | Jira project `AIT`; personal projects have no tracker |
| `move-jira-status` | Jira transition-id cache |
| `gitlab-pr-post` | Slack routing via a company `developer-channels.json` |
| `gitlab-mr-workflow` | **Dead** — the file itself says "superseded, use `creating-gitlab-mrs`" |
| `ai-models-config-mcp` (plugin) | Company MCP server, per your call |

Also not carried over: the `artlist-skills-market` marketplace, the `architecture`
and `coralogix` plugins, the Jira MCP server, and the 3 repo-specific review
commands (folded into one — see below).

`gitlab-mr-workflow` is worth calling out separately: it was a tombstone pointing
at another skill, still loading its description into every session's skill list.

---

## Generalized (11 + 3 commands)

These were genuinely useful workflows wearing GitLab-specific clothing. Renamed
`mr-*` → `pr-*` and rewritten to detect the forge from the origin remote.

| Was | Now | What changed |
| --- | --- | --- |
| `gitlab-mr-review` | `pr-review-workflow` | Dual `gh`/`glab` fetch + diff; dropped "never use gh" |
| `creating-gitlab-mrs` | `creating-prs` | Jira gate became "follow the project's convention"; dual create commands; generic env-split example |
| `address-mr-feedback` | `address-pr-feedback` | Script rewritten on the shared forge layer |
| `mr-second-review` | `pr-second-review` | Dual approve/diff/resolve |
| `post-mr-inline-comments` | `post-pr-inline-comments` | Both position models handled by the script |
| `verify-mr-state` | `verify-pr-state` | GitLab pipelines *and* GitHub check-runs; normalised state word |
| `verify-resolve-mr-comments` | `verify-resolve-pr-comments` | Thread resolution across REST and GraphQL |
| `fix-mr-conflicts` | `fix-pr-conflicts` | Forge-neutral metadata lookup |
| `mr-feedback-harvest` | `pr-feedback-harvest` | `--group` → `--scope` (GitHub org or GitLab group) |
| `reviewing-pr-code` | same | Removed "or Artlist projects"; internal-registry example made generic |
| `dependency-bump` | same | Removed `@models/*` package examples |
| 3 × `*-pr-review` commands | `/pr-review` | Three near-identical repo-specific commands collapsed into one that takes a target and reads the repo's own rules |

### The shared forge layer

The three PR scripts each re-implemented GitLab auth and metadata fetching, and
read the token out of `glab config get token`. They now share `lib/forge.py`,
which:

- detects the forge from `origin` and normalises the response shapes;
- routes every call through `gh api` / `glab api` so **no script reads a token**;
- hides the parts that genuinely differ — GitLab's `line_code` position payload
  vs GitHub's `path`/`line`/`side`, and thread resolution (GitLab REST vs GitHub
  GraphQL `resolveReviewThread`, which needs a REST-id → node-id mapping);
- computes the merge base locally on GitHub, which has no `diff_refs.base_sha`.

Verified live against this account: forge detection, change-request view, thread
listing, CI status (`success` from real check-runs), and the GraphQL thread query.
**Not** exercised against a live thread — no PR in the test repo had review
comments — so the comment-posting, reply, and resolve paths are implemented and
argument-validated but unproven end-to-end. Worth one real comment on a scratch PR
before relying on them.

### Bugs found and fixed on the way

- `pr-feedback-harvest` fetched only the **first 100** results on GitHub with no
  pagination — a retro over a busy window would silently under-report. Now pages
  through, and warns when it hits GitHub's hard 1000-result search ceiling.
- `harvest.py` violated your own `python.md` rules throughout (`ap`, `n`, `m`,
  `enc`, `disc`, `pos`, no docstrings). Rewritten to comply.
- Ten skills cross-referenced each other by **old names** after the rename
  (`fix-mr-conflicts`, `mr_review_comments.py`, `creating-gitlab-mrs`…). All
  chains would have broken. Fixed and verified none remain.
- `pr-feedback-harvest`'s doc documented `--group`/`--today` and an output
  filename the rewritten script no longer produces. Re-synced.
- `address-pr-feedback` documented `--body-file`, which the script never
  supported. Added it, since replies are multi-line markdown.
- Every skill's `name:` frontmatter now matches its directory — several would not
  have loaded after the rename.

---

## Kept as-is (18)

Already project-agnostic:

`brainstorming`, `writing-plans`, `executing-plans`, `subagent-driven-development`,
`test-driven-development`, `verification-before-completion`, `using-git-worktrees`,
`pre-push-quality-gate`, `finalize-pr`, `writing-pr-description`,
`run-service-in-docker`, `open-with-cursor`, `http-file-generator`, and the five
`cmux-*` skills.

Provenance note: the first seven are derived from the `superpowers` plugin
(`obra/superpowers-marketplace`), vendored into `~/.claude-personal/skills` while
the plugin itself is disabled. They are carried here so a new machine works
offline, but upstream may have moved on — worth diffing against the plugin
occasionally rather than assuming these are current.

---

## Rules

The four rule files are in good shape — invariant-shaped, `paths:`-scoped, and
non-overlapping. `code.md` holds the language-agnostic craft rules, with
`typescript.md` and `python.md` layering specifics on top; that split is correct
and worth keeping.

Applied:

- **`code.md` now covers `.sh`/`.bash`.** It already claimed to be
  language-agnostic and listed sql, go, java, rb — but shell scripts, where
  braceless control flow and abbreviated identifiers are most common, were
  excluded.
- **Generalized the one company reference** (`// AIP-123` → `// ABC-123`) in
  `code.md` and `rules-reference.md`.
- **Added `rules/config.md`** — scoped to env files, Terraform, settings/MCP JSON,
  compose, helm values, and CI YAML. Two rules: *Secrets Never Live in a Tracked
  File* and *A New Environment Variable Is Added Everywhere It Is Read*.

That secrets rule was not theoretical. The extracted config contained a live Slack
bot token and a Coralogix API key in `settings.json`, and an Atlassian API token in
`.mcp.json` — all plaintext, none gitignored. **Rotate all three**; they predate
this repo and deleting the line does not un-leak them.

---

## Worth considering (not applied)

1. **`reviewing-pr-code` vs the built-in `/code-review`.** They overlap heavily now
   that `/code-review` ships with the harness. Yours adds repo-rule checking and
   the inline-comment pass; the built-in adds multi-agent verification. Consider
   thinning yours to just the parts the built-in lacks.
2. **`skillOverrides` had 18 skills switched off** in the work profile — including
   all five `cmux-*` ones. If they have been off for months, that is evidence for
   deleting rather than porting them. They are here; the off-switch is not.
3. **The two profiles had drifted apart** only in plugins and MCP, never in skills.
   That is a good sign, but it happened by manual copying. Now that both symlink
   the same directory, drift is structurally impossible.
4. **`finalize-pr` and `pr-second-review` both delegate to a Sonnet subagent** with
   near-identical "anti-recursion guard" preambles. That pattern is repeated in
   seven skills — a candidate for a single shared reference the way `forge-cli.md`
   now serves the forge commands.
5. **No `agents/` directory exists** in either profile. Every agent in use is
   built-in. If you find yourself repeating a subagent prompt, that is the signal
   to add one here.

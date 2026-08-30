# Rules Reference — Full Text

The unabridged version of every rule. `~/.claude/shared-rules.md` carries the compressed
form and is loaded into every session; this file is **read on demand** — when a rule's
application is unclear, when you need the worked example, or before codifying a new rule.

Rules that live *only* here (dropped from the always-loaded file because they are
situational rather than general): Status Line, HTTP Client Wrappers, MUI disabled
handlers, Skills Committed to a Shared Repo, Edit Forms Round-Trip, Call Through an
Authenticated CLI.

---

# Global Claude Instructions

## Developer Context
You are working with a Senior Developer. When suggesting rules or patterns:
- Focus on high-level concerns: SOLID principles, performance, security, type safety, architectural patterns
- Skip basic syntax explanations
- Be direct and concise

## Memory Management Protocol

After completing any fix for a code implementation or style choice, evaluate whether the fix reflects a **recurring architectural or stylistic preference** (not a one-off mistake). Signals include:
- The same pattern was fixed in multiple places
- The fix reflects a general design decision (e.g., prefer composition over inheritance, always validate at boundaries, avoid implicit any)
- The fix applies to a tech stack or domain pattern (e.g., React hooks conventions, REST API response shapes, SQL query structure)

If the fix appears to be a recurring preference, explicitly ask:
> "Should I codify this into a new or existing rule to prevent this in the future?"

### If the user says Yes:
- **General preference** (language-agnostic, applies across projects): Update `~/.claude/shared-rules.md` directly by appending to the `## Coding Preferences` section below
- **Project/stack-specific preference** (e.g., specific to React, Python, this repo's conventions): Ask the user:
  > "This looks project-specific. Should I add it to `.claude/rules/` in the current project?"
  Then create or update the appropriate file in `.claude/rules/<topic>.md`

### Rule format
When writing a rule, use this format:
```
**[Rule Name]** — [One-line rationale]
> Pattern: [what to do]
> Avoid: [what not to do]
> Example: [optional inline example if non-obvious]
```

## Status Line

The status line is configured via `~/.claude/statusline-command.sh` (robbyrussell theme). It should always show:
- Green arrow `➜` + cyan directory + git branch (red) with dirty marker (yellow `✗`)
- Current model name in magenta (e.g. `[Claude Opus 4.6]`)
- Context usage percentage, color-coded: green (<50%), yellow (50–74%), red (75%+)

Format: `➜  dir git:(branch) ✗ [Model Name] ctx:42%`

## Communication Preferences

**Full File Paths in Links** — Lets the user click the path to open the file directly, without resolving it manually
> Pattern: Whenever referencing a file to the user (in prose, as a "here's the file" pointer, or after creating/editing a file), always give the full absolute path from the filesystem root — not a relative path, not a bare filename, not a path relative to an assumed working directory.
> Avoid: Relative paths (`./docs/foo.md`), bare filenames (`foo.md`), or paths that only make sense given unstated context about the current working directory.
> Example: `/Users/yaniv/Documents/project/docs/foo.md` — not `docs/foo.md` or `foo.md`.

## Commits and Merging

**Always Squash on Merge** — The base branch should read as a list of shipped changes, one line per PR, not as a transcript of how each change was arrived at. An agent-driven PR is especially noisy: it accumulates a test-first commit, an implementation commit, a `/simplify` commit, a review-fixes commit, and a docs commit, none of which mean anything to someone reading `git log` six months later. Squashing also makes `git revert <sha>` undo an entire feature rather than one arbitrary slice of it, and makes `git bisect` land on shippable states instead of half-built ones.
> Pattern: Squash-merge every PR you own and delete the branch. The squash message defaults to the PR title, so write that title as a conventional commit (`<type>(<scope>): <description>`) — that title, not any commit on the branch, becomes the permanent base-branch history, so the type and scope have to be right there. The forge command mapping (`gh` vs `glab`) is in the `pr-workflows` plugin's `references/forge-cli.md`; read it rather than guessing flags.
> Avoid: Merge commits, which preserve every intermediate step and add a merge commit on top. Rebase-merges, which replay each commit onto the base branch individually — same noise, no merge commit. Clicking a repo's default merge button without checking which strategy it is configured for.
> Exception: Never squash-merge a branch someone else is still committing to — squashing rewrites what they branched from. This is about your own finished PRs.
> Note: Within a branch, commit as often as is useful. Granular commits are how you work; they are not what the base branch keeps. The squash is what reconciles those two, which is why a noisy working history is not a reason to avoid committing often.

**Ship `claude-config` Changes; Never Leave Them Uncommitted** — `install.sh` symlinks this repo's files into `~/.claude` rather than copying them, which is what makes an edit take effect immediately — and is exactly why an uncommitted edit is invisible drift. The change is live on the machine that made it and exists nowhere else: not on the other profile, not on a new machine, not in any history that could later explain why the config behaves as it does. Because the symlink makes the change *work*, nothing prompts you to finish shipping it; the feedback loop that would normally catch an unfinished change is precisely what the symlink removes.
> Pattern: Any change under `~/Develop/claude-config` — statusline, `shared-rules.md`, `rules/`, `settings/`, `keybindings.json`, `plugins/` — gets a branch, a PR, a squash-merge to `main`, and a `git pull --ff-only` on `main` afterwards so the symlink target matches `origin`. Treat this as standing authorization granted once: do it without asking, in the same session that made the change, rather than reporting the edit and waiting for permission.
> Avoid: Committing directly to `main` or force-pushing — the PR is what gives the change a title and a rationale worth reading later. Leaving the edit dirty "until the end of the session", which is how drift accumulates in the first place.
> Corollary: Commit only the files your change touched. This repo tends to carry unrelated dirty files from earlier sessions; `git stash push <paths>` them, commit yours, then pop. Bundling someone else's unfinished rule into your PR mislabels it as reviewed.
> Corollary: A skill, command, or agent created directly in `~/.claude/skills`, `~/.claude/commands`, or `~/.claude/agents` is **not** covered by the installer — it leaves those alone deliberately. Such a file is local-only and untracked no matter how many times the repo is committed. To ship it, move it into `plugins/<plugin>/` here and let the plugin deliver it. Because this failure is silent and easy to forget, the check for it belongs in tooling, not in memory.

## Coding Preferences

**Array Type Syntax** — Consistent, concise type annotations
> Pattern: Use `T[]` shorthand for array types (e.g., `string[]`, `{ id: number }[]`)
> Avoid: `Array<T>` generic syntax (e.g., `Array<string>`, `Array<{ id: number }>`)

**Self-Documenting Code Over Comments** — Code should explain itself; comments are a last resort
> Pattern: Only add a comment when the code contains a genuine hack, a non-obvious invariant, a workaround for a specific external bug, or behaviour that would actively surprise an experienced reader. The bar is high: if a competent developer would understand the code without the comment in under 5 seconds, delete it.
> Avoid: Comments that restate what the type system, decorators, or field names already express (e.g. explaining that an `@IsOptional()` field is optional); task-ticket references (`// ABC-123: ...`); backward-compat explanations where the optionality itself is self-evident; and any comment explaining *what* the code does rather than *why* a surprising choice was made.
> Example: `@IsOptional() generationMethod?: GenerationMethod` needs no comment — the decorator and `?` already communicate everything. A comment belongs when the code does something counter-intuitive that naming alone cannot fix.
> Example: Instead of `// check if user is eligible for discount` followed by a complex condition, extract to `isEligibleForDiscount(user)`.
> Applies to **configuration as much as code** — Helm values, `.env`, CI YAML, Terraform. The title says "code", and that wording invites an unearned exemption for config files; there isn't one. A key's name and value normally say everything, and config has no types or functions to extract to, so the temptation to narrate each line is strongest exactly where the payoff is lowest. Comment only what the file cannot show: a hidden behaviour of the chart/tool consuming it, a key that is silently inert unless mirrored somewhere else, or a workaround for an upstream bug.
> Example: `WORKER_HEALTH_PORT: 3000` sitting beside `containerPort: 3000` needs no comment. `# startupProbe has no path of its own in this chart — it reuses readinessProbe.path` earns one: it is chart behaviour invisible from the values file, and a reader who changes `readinessProbe.path` would silently move the startup gate too.

**Public-First Method Ordering** — Top-down readability: high-level intent first, implementation details last
> Pattern: Place exported/public methods at the top of the file/class, private/helper methods at the bottom. A reader should grasp what a module does by reading only the top portion, then drill into private methods below for implementation details.
> Avoid: Interleaving private helpers between public methods, or placing private methods above the public API they support.

**Declare Shapes With `type`, Not `interface`** — one keyword removes a per-declaration decision, and a duplicate `type` is a compile error where a duplicate `interface` silently merges into one shape
> Pattern: Reach for `type` for every object shape — DTOs, component props, config objects, function signatures. A type alias also expresses unions, tuples, primitives and mapped types, so widening a shape later (`type Result = Ok | Err`) never means converting the declaration form. It is also the form the rest of these rules assume: "Name Derived Types" and "Avoid `Pick` for Small Field Selections" both name a `type`.
> Avoid: `interface` for an ordinary shape. Two reasons beyond consistency. (1) Interfaces merge: a second `interface User` in the same scope adds fields instead of erroring, so a bad import or a copy-paste produces a silently wrong type. `type User` declared twice fails to compile. (2) Interfaces are implicitly open, so an interface-typed value is not assignable to `Record<string, unknown>` — it fails at logging helpers, JSON serializers, and ORM filter arguments where a structurally identical `type` alias passes.
> Exception: Declaration merging is the one thing `type` cannot do. Module augmentation (`declare module 'express' { interface Request { userId: string } }`) and global augmentation require `interface`. So does a deep shape extended many times: `interface B extends A` is checked once and cached, where a chain of `A & B & C` aliases is re-checked structurally and reports errors as an expanded wall of properties rather than a name.
> Example: `type CreateUserBody = { email: string; name: string };` — not `interface CreateUserBody`. But `declare module 'fastify' { interface FastifyRequest { tenant: Tenant } }` stays an interface, because merging into Fastify's own declaration is the whole point.

**Type Placement** — keep type definitions out of implementation files so each file has one job and stays readable
> Pattern: A type used only inside one file is declared at the top of that file, before any logic. A type shared across files goes in a co-located `<module>.types.ts`, named to match its sibling (`ffmpegOnlineClient.ts` → `ffmpegOnlineClient.types.ts`). The types file holds shapes only; the implementation file holds functions and classes only.
> Import direction: Consumers import shapes straight from `<module>.types.ts`, with `import type`. Under `isolatedModules`/`verbatimModuleSyntax` — esbuild, swc, Vite, Babel — the transpiler works one file at a time and cannot tell that a value import is type-only, so `import { MixAudioRequestBody } from './ffmpegOnlineClient'` emits a real runtime edge to the client and drags its transitive dependencies into a consumer that only wanted a shape. Re-export from the implementation file (`export * from './x.types'`) only when extracting types out of a module whose callers already import them from there — it is a compatibility shim for existing call sites, not the front door. A new module needs no re-export.
> Never let `<module>.types.ts` import from its implementation sibling. That is the circular import this layout invites, and a re-export hides it.
> Avoid: A project-wide `types.ts` dumping ground — it destroys locality and becomes a cycle magnet. Mixing exported type definitions with implementations. Scattering internal type declarations through the body of a file.
> Exception: Activities and steps are short by design; their input/output types stay co-located in the same file.
> Example: `ffmpegOnlineClient.types.ts` holds `MixAudioRequestBody` and `FfmpegFileResponse`; `ffmpegOnlineClient.ts` imports what it needs and defines only functions; an activity does `import type { MixAudioRequestBody } from '../providers/ffmpegOnlineClient.types'`.

**Always Use Braces for Control Flow** — Consistent, readable, less error-prone
> Pattern: Always wrap `if`/`else`/`for`/`while` bodies in braces `{ }`, even for single statements — including early returns and guard clauses.
> Avoid: Braceless one-liners like `if (condition) doSomething();`, `if (condition)\n  doSomething();`, or `if (!x) return null;`
> Example: `if (condition) { doSomething(); }` — `if (!x) { return null; }` — not `if (!x) return null;`

**Fix ESLint Issues Instead of Suppressing** — Lint rules exist for a reason; disabling them hides problems
> Pattern: When ESLint flags an issue, fix the underlying code to satisfy the rule. Refactor, retype, or restructure as needed.
> Avoid: Adding `// eslint-disable-next-line` or `// eslint-disable` comments. Only use them as an absolute last resort when there is genuinely no way to satisfy the rule.

**Avoid `Pick` for Small Field Selections** — `Pick<T, 'field'>` obscures intent when only 1–3 fields are fixed
> Pattern: Inline the type directly (`{ priority: number }`) or create a dedicated named type. Reserve `Pick` for dynamic/generic utility usage where fields are variable or computed.
> Avoid: `Pick<SomeType, 'singleField'>` or `Pick<T, 'a' | 'b'>` when the selected fields are static and few.
> Example: Instead of `Pick<PriorityResolution, 'priority'>`, write `{ priority: number }` or define `type ResolvedPriority = { priority: number }`.

**Name Derived Types, Never Inline Them in a Signature** — a composed type expression in a parameter or return position forces the reader to evaluate type algebra before they can read what the function does
> Pattern: Bind the composition to a `type` alias with a domain name and a one-line comment saying what it represents, then use the alias in the signature. The signature then reads as prose, and the derivation stays in one place where its intent can be explained.
> Avoid: `Required<Pick<…>>`, `Omit<Exclude<…>>`, or any 2+ layer utility-type composition written inline in a function signature.
> Also avoid: exporting the raw field-union so each consumer re-composes `Required<Pick<…>>` in its own way — export the finished alias, so every call site names the same thing rather than re-deriving it.
> Keep the derivation: naming it is about the signature being readable, not about hand-writing the field list. A type derived from a schema/ORM model still fails to compile when a column is added — usually the whole reason it was derived.
> Example: `type PackageAssignmentCreateData = Required<Pick<Prisma.ModelUnlimitedPackageAssignmentCreateManyInput, PackageAssignmentContentField | 'modelId'>>;` then `function buildPackageAssignmentCreateData(assignment, targetModelId): PackageAssignmentCreateData` — not the composition spelled out in the return position.
> Origin: APPS-942, where three clone/diff builders each inlined a different `Required<Pick<…>>` over the same Prisma model; naming them (`PackageAssignmentContent`, `PackageAssignmentCreateData`) made the shared field set obvious and let the consumer import one name instead of re-composing.

**Explicit Class Access Modifiers** — All class members must have explicit `public`, `private`, or `protected`
> Pattern: Always annotate every class method and property. TypeScript's default-public rule makes access level invisible without annotation. Helper/internal methods belong as `private` class methods, not module-level functions.
> Avoid: Methods or properties with no access modifier (implicit `public`); free-standing module functions that are logically tied to a single class.
> Example: `public resolve(): void`, `private resolvePriority(...)`, `private resolvedPackage: X` — not bare method signatures.

**Conventional Commits for Commit Messages** — Consistent commit history that drives release pipelines
> Pattern: Format commit messages as `<type>(<scope>): <description>`. Types: `feat`, `fix`, `refactor`, `perf`, `test`, `docs`, `style`, `build`, `ci`, `chore`, `revert`. Scope is typically a ticket number or module name.
> Avoid: Free-form commit messages like `"fix stuff"` or `"update code"`. Always include a type prefix.
> Example: `feat(auth): add OAuth login flow` — not `"added login"`.

**Avoid TypeScript `as` Casts** — Explicit casts suppress the type checker and can hide runtime type mismatches
> Pattern: Eliminate `as` by narrowing the type properly: use a type guard, an `if (!x)` guard that throws, or let TypeScript infer from the assignment (`const x: T = expr` assigns `any` without a cast). Reserve `as unknown as T` only when bridging genuinely incompatible types that can't be expressed otherwise.
> Avoid: `const body = response.Body as SomeInterface`, `value as string`, or any cast that papers over a missing type guard.
> Example: Instead of `const body = response.Body as { transformToString(): Promise<string> }`, check `if (!response.Body) { throw new Error(...) }` and then call `response.Body.transformToString()` directly using the SDK's native type.

**Prefer Established npm Packages Over Hand-Rolled Implementations** — Libraries are battle-tested, maintained, and edge-case aware
> Pattern: Before writing custom parsing, formatting, transformation, or data-structure logic, check whether a well-maintained npm package already solves the problem (e.g., `csv-parse`/`csv-stringify` for CSV, `lodash` for collections, `date-fns` for dates). Use the package unless the dependency weight clearly outweighs the benefit.
> Avoid: Hand-rolling CSV parsers, date formatters, deep-merge utilities, or other logic that well-known libraries already handle correctly.
> Example: Replace a custom `parseCsvLine` loop with `csv-parse/sync`'s `parse(csv, { columns: true })`.

**Prefer `switch` Over `else if` Chains** — Switch statements are clearer and exhaustive when branching on a single value
> Pattern: When a conditional block branches on a single expression against multiple discrete values (characters, strings, enums, status codes), use `switch`. Add a `default` case to handle unexpected values explicitly.
> Avoid: Long `else if` chains evaluating the same variable against different values (e.g., `if (char === '"') { ... } else if (char === ',') { ... } else if ...`).
> Example: `switch (char) { case '"': ...; break; case ',': ...; break; default: cell += char; }` — not a chain of `else if (char === ...)`.

**No Abbreviated Identifiers** — Names must be self-explanatory without domain knowledge or context
> Pattern: Use full, descriptive names for types, variables, and parameters. A reader should understand the role of an identifier from its name alone without referring to surrounding code.
> Avoid: Single-letter variables outside conventional loop indices (`i`, `j`) and sort comparators (`a`, `b`); cryptic abbreviations like `Acc`, `Cfg`, `Ctx`, `Mgr`, `Svc`, `Evt`, `Res`, `Req`, `Msg`.
> Example: `type FingerprintAccumulator` not `type Acc`; `(acc) => acc.count` not `(a) => a.count`; `connectionConfig` not `cfg`.

**HTTP Client Wrappers** — Encapsulate all HTTP calls to an external service behind a dedicated client module
> Pattern: Create a client module (e.g. `src/providers/ffmpegOnlineClient.ts`) that owns the base URL, headers, and transport concerns. Expose one typed function per endpoint. Any caller — activity, step, or helper — imports and calls the client function instead of calling `gotJson`/`fetch` directly.
> Avoid: Scattering `gotJson` / `fetch` calls across activities or steps with inline base-URL construction, header duplication, or copy-pasted timeout logic. Each new call site for the same service should add one function to the existing client, not introduce a new raw HTTP call.
> Example: `ffmpegOnlineClient.ts` exposes `mixAudio(body, timeout)`, `muxVideoAudio(body, timeout)`, `extractAudio(body, timeout)`. Activities call these; they never construct `${FFMPEG_ONLINE_API_BASE_URL}/v1/audio/mix` themselves.

**Run Subagents From the Repo They Modify** — Each repo's CLAUDE.md, rules, and skills must be in the agent's context
> Pattern: When dispatching a subagent whose changes target a different repository than the current working directory, anchor it to that repo: state the target repo's absolute path at the top of the prompt, instruct it to read that repo's CLAUDE.md (and `.claude/rules/` if present) before changing anything, and run that repo's own package.json/build/test/lint scripts — never the current repo's.
> Avoid: Dispatching subagents that edit sibling-repo files via absolute paths while implicitly assuming the current repo's conventions, build commands, or lint rules apply.
> Example: Task editing a sibling repo → subagent prompt begins: "Work in /absolute/path/to/repo. cd there, read its CLAUDE.md first, use its own scripts for build/test/lint."

**Dedicated Validator Class for 2+ Assertions** — Keeps guard-rail logic testable, reusable, and out of service/controller bodies
> Pattern: When an operation needs more than one assertion/guard check before it's allowed to proceed (existence, status/lifecycle eligibility, uniqueness, membership, ownership, etc.), extract those checks into a dedicated validator class (e.g. `modelWriteValidator`, `candidateWriteValidator`), exposing one public method per guarded operation (e.g. `assertCanCreateCandidate`). The validator depends on the domain's data-access layer for lookups — never the raw DB client/ORM directly — and throws typed domain errors. The calling service/controller stays thin: it just awaits the validator before proceeding.
> Avoid: Stacking two or more independent `if (...) throw ...` checks inline inside a service method or controller action. A single guard (one condition before a lookup) can stay inline; once there are 2+ independent conditions guarding the same operation, extract them into a validator.
> Example: `candidateWriteValidator.assertCanCreateCandidate(liveModelGroupId)` — checks the group exists, is live, has live members, and has no existing candidate — replaces four inline checks that used to live directly in the calling service method.

**Actionable Error Messages** — Thrown errors should carry enough context to debug without re-running the code
> Pattern: When throwing an error for invalid/missing input, interpolate the actual input values (or relevant identifiers) into the message so logs are self-sufficient.
> Avoid: Generic messages like `'videoFileUrl or videoFileKey must be provided'` with no indication of what was actually received.
> Example: `` `videoFileUrl or videoFileKey must be provided (videoFileUrl: ${input.videoFileUrl}, videoFileKey: ${input.videoFileKey})` ``

**Prefer async/await Over Promise Chains** — Top-to-bottom readable control flow for asynchronous code
> Pattern: Use `async`/`await` with `try`/`catch` for all asynchronous functions, including fire-and-forget background jobs that the caller invokes without `await` (e.g. a function kicked off after an HTTP response has already been sent). The function itself should still be `async` internally even if nothing awaits it externally.
> Avoid: Raw `.then()`/`.catch()` promise chains. They read as two disconnected callback branches instead of linear control flow, even though `.then()` followed by `.catch()` and `try`/`await`/`catch` are functionally equivalent (a throw in the success path falls through to the failure path either way).
> Example:
> ```ts
> async function processInBackground(model: Model): Promise<void> {
>   try {
>     const { result } = await doWork(model);
>     await publishResult({ status: 'completed', result });
>   } catch (error: any) {
>     await publishResult({ status: 'failed', errorMessage: error.message });
>   }
> }
> ```
> not: `doWork(model).then((result) => publishResult(...)).catch((error) => publishResult(...))`

**Extract Multi-Branch Inline Expressions to Private Methods** — Ternaries and compound conditions inside argument lists obscure intent and resist testing
> Pattern: When an argument to a function/method call requires a multi-branch expression (ternary with non-trivial branches, compound condition, nested `??`) that cannot be read at a glance, extract it to a private method with a name that states the decision. The call site should read like a sentence; the method body is where the mechanics live.
> Avoid: Inline ternaries or compound conditions directly inside object literals or argument lists that require more than a second to evaluate.
> Example: `concurrencyCap: this.getConcurrencyCap(isCredits, unlimitedPackage)` — not `concurrencyCap: isCredits ? CREDITS_CONCURRENCY_LIMIT : (unlimitedPackage?.concurrency ?? 0)`.

**Enum-Driven Allowlists Must Be Exhaustive** — a `Set`/`ReadonlySet` literal built from a handful of enum members compiles fine forever; when a new enum value is added later, nothing forces a decision about whether it belongs, so the code silently falls through to whatever default branch handles "not in the set."
> Pattern: When gating logic on a subset of an enum's values, express the allowlist as an object literal covering every enum member, typed `satisfies Record<TheEnum, boolean>` (or the richer value type the logic needs). Adding a new enum member then fails to compile until the object is updated with an explicit value for it.
> Avoid: `new Set([Enum.A, Enum.B])` / `new Set<Enum>([...])` followed by `.has(value)` as the gate for enum-subset logic — it silently omits future enum members instead of erroring.
> Example: `{ [Status.ON_AIR]: true, [Status.DRAFT]: true, ..., [Status.ARCHIVED]: false } satisfies Record<Status, boolean>` with lookup `allowlist[status]` — not `new Set([Status.ON_AIR, Status.DRAFT]).has(status)`.

**Non-Critical Side Effects Must Not Fail the Primary Operation** — a cache invalidation, analytics call, or other non-critical side effect failing should never turn a successful DB write into a 500
> Pattern: Wrap non-critical side-effect calls (cache invalidation, event publishing best-effort, analytics) in try/catch, log a warning on failure, and emit a metric so failures are observable — do not let them propagate and fail the request. Add an alert on the failure metric if the side effect matters for correctness/freshness.
> Avoid: Awaiting a side-effect call with no try/catch on a request path where the primary operation (e.g. DB write) already succeeded.
> Example: `try { await cacheHelper.invalidate(...); } catch (error) { logger.warn('Cache invalidation failed', { error }); metrics.increment('cache.invalidation.failure'); }` — not a bare unguarded `await cacheHelper.invalidate(...)`.

**Don't Re-Guard MUI Interactive Handlers Against `disabled`** — MUI's `disabled` prop already sets `pointerEvents: 'none'` on the component (and its children), so `onClick`/`onDelete`/etc. are unreachable via pointer interaction the moment `disabled` is true — a ternary that swaps the handler for `undefined` when disabled is dead code protecting against something that can't happen.
> Pattern: Pass `disabled={disabled}` and the handler unconditionally on MUI interactive components (`Chip`, `Button`, `IconButton`, etc.). Let the component's own disabled styling/pointer-events suppress the interaction.
> Avoid: `onClick={disabled ? undefined : () => ...}` / `onDelete={disabled ? undefined : () => ...}` alongside `disabled={disabled}` on the same MUI component.
> Example: `<Chip disabled={disabled} onClick={() => onValuesChange(...)} />` — not `<Chip disabled={disabled} onClick={disabled ? undefined : () => onValuesChange(...)} />`.

**Rules and Docs State Invariants, Not a Census of Current Violations** — a list of "these fields currently break the rule" is correct only until someone fixes one of them, and nothing fails when it goes stale; a reader then trusts a wrong list, or worse, copies a "known defect" entry as the pattern
> Pattern: In rule files, review checklists, and CLAUDE.md-style docs, state the invariant ("every flag in this block coerces with `?? false`"), then point at the file to verify against. Note that pre-existing violations exist without enumerating which ones, so the reader checks the invariant rather than the neighbours.
> Avoid: Enumerating which specific fields/files currently violate the rule ("`isComingSoon` is bare, `isNew` is nullable, three DTO fields are mistyped"). The census rots silently, and it invites "my field matches the neighbour, so it's fine."
> Example: "**Invariant:** a new boolean flag on `Model` is `Boolean @default(false)`. If the peer you're mirroring is `Boolean?`, that peer is the anomaly — read the declarations, don't assume." — not a bullet list of which existing flags are nullable today.

**Skills Committed to a Shared Repo Must Be Self-Contained** — a repo-committed skill that calls a personal global skill (`~/.claude/skills/*`) works for its author and silently does nothing for every teammate; they follow the documented step and hit a missing dependency
> Pattern: Vendor the script next to the skill (`.claude/skills/<name>/<script>.py`) or document a raw-CLI fallback, so the whole flow runs on tools everyone has (`glab`, `git`, `python3`) plus files in the repo. Reference a personal global skill only as an optional convenience, never as a required step. Also make the frontmatter agree with itself: `disable-model-invocation: true` contradicts a description written as auto-invoke trigger text — pick one.
> Avoid: "Prerequisite: install `<personal-global-skill>` before using this path" in a skill checked into a shared repo.
> Example: `python3 .claude/skills/custom-pr-review/post_inline_comment.py --mr <N> ...` — not "→ the **post-mr-inline-comments** skill (`~/.claude/skills/post-mr-inline-comments`)".

**Pass Rule-File Paths to Subagents, Never Inlined Contents** — an agent can read a file itself; a file pasted into a prompt or a `Workflow` `args` string competes for context and truncates, and it truncates worst exactly where the input is largest
> Pattern: Give the subagent the worktree path plus the rule-file paths and let it read them. Keep this identical across size tiers — the big-input tier is the one that most needs the path, not the inline copy.
> Avoid: Appending a rule file's text into an `args` string or prompt body; or two tiers of the same workflow loading the same rules by different mechanisms (one by path, one inlined).
> Example: `args: "worktree=<path> rules=.claude/rules/review-angles.md"` — not `args: "rules:\n" + <full file text>`.

**Edit Forms Must Round-Trip Values Their Allowlist Doesn't Recognize** — when the stored contract is wider than the curated list a UI offers (a plain `string` column vs. a hand-maintained enum of display labels), mapping the stored value through that allowlist yields `undefined` for anything off-list. The control renders blank, and if the field is required, saving *any* other field is blocked — so editing one unrelated field silently forces a re-classification, and the original value is lost with no warning.
> Pattern: Type the edit schema as wide as the stored contract (`z.string().trim().min(1)`), seed the form with the raw stored value, and append an unrecognized value to the option list so it stays selected. Say so inline (helper text on that field) rather than leaving a mystery blank. Keep the narrow enum on the *create* schema, where every value is newly chosen. Combined with a diff-only payload, an untouched off-list value is then never written back.
> Avoid: A `toX(stored)` allowlist lookup that returns `undefined` feeding a required field; a UI-side enum that silently drops values the API accepts. Applies equally to a `<select>`/Autocomplete whose options come from a churny UI constant.
> Example: edit schema `errorType: z.string().trim().min(1)` + `options={toErrorTypeOptions(field.value)}` — not `errorType: z.nativeEnum(UI_LABELS)` with `reset({ errorType: toErrorType(stored) })`.

**A Shared Helper Asserts Its Precondition Instead of Quietly Honouring It** — when one constraint is encoded twice (a loud guard at the boundary that rejects with an actionable message, plus a defensive compare inside a reusable helper that just skips the field), the helper's copy is the quiet one. It can only ever fire for a caller that skipped the guard — precisely the caller that needs to be told — and for that caller it swallows the user's stated intent instead of failing.
> Pattern: Express the constraint once as a named predicate. Call it at the boundary to produce the user-facing error, and have the helper `throw` on that same predicate with the identifiers interpolated. A compare kept only for type narrowing then reads as a documented precondition rather than a hidden decision. Test it as an expect-throw, so the test documents the underlying limitation rather than pinning a silent no-op in place.
> Avoid: A `if (value !== null && value !== current) { changes.field = value }` shape inside a shared builder that silently omits a field the caller asked to clear, while a sibling guard rejects the same state loudly one function up.
> Example: `buildErrorMappingUpdatePayload` opens with `if (isUnsupportedWorkflowErrorCodeClear(values, mapping)) { throw new Error(...) }`, reusing the very predicate the form calls — not a bare `!== null` clause that drops the cleared code.

**A Guard Must Be Reachable From Every Path That Writes What It Guards** — a pre-flight check added to the endpoint whose bug motivated it reads as complete: the check exists, it is in a validator, and its tests pass. What review does not see is the sibling entry point that writes the same field without passing through it. A dedicated `PATCH /:id/status` is almost never the only writer of `status` — the generic `PUT /:id` usually accepts it too, spreads it straight into the update, and runs only whichever validator it already called. Every test of the guarded path stays green, so the gap surfaces later as corrupted data whose write path nobody suspects.
> Pattern: Before adding a check, enumerate the write paths for the field it guards — grep the callers of the data-access method that persists it, not the route you happen to be editing — and put the check in the shared validator every one of them already routes through. Where a service method holds the loaded entity and a validator does not, expose the check as a public method that loads the entity itself and delegates to the shared private implementation, so there is one implementation and two entry points rather than two copies.
> Avoid: A guard living in one controller action; or a validation service method reachable only from the "primary" status endpoint while a generic update writes the same column unchecked.
> Example: `modelWriteValidator.validateUpdate` calls `modelStatusValidationService.validateGroupReferencesAreReleased(modelId, status)`, so `PUT /:id` and `PATCH /:id/status` (and the preset controllers delegating to both) run the same default-model/routing-reference release check — not a check reachable only from `validateStatusChange`.

**Every New Env Var Has a Default** — an env var that throws when unset couples "deploy the code" and "configure the environment" into one atomic step, which no deployment platform gives you. The code lands first, the dashboard entry lands seconds later, and every request in between 500s — on a route that has nothing to do with the new feature if the read sits in shared middleware. The same failure recurs for anyone bringing up a second environment (preview, local, a teammate's machine) who has no reason to know the new key exists.
> Pattern: Read new vars through the optional accessor so unset resolves to a defined value — in this codebase `optionalEnv(name)`, whose fallback is `''`. Pass an explicit fallback whenever the useful default is not empty (`optionalEnv('X_TIMEOUT_MS', '5000')`), and keep the one-argument form when it is, matching the existing call sites. Choose a default that makes the feature *inert* rather than half-configured: an unset integration URL means "this integration is off", not "post to an empty URL". Add the key to `.env.example` with its default value so unset is a documented state rather than an oversight.
> Avoid: `requireEnv('NEW_FLAG')` anywhere on a request path; a `zod` env schema that gains a `.min(1)` entry for a var only one feature needs; a feature whose absence of config surfaces as a 500 instead of as "disabled".
> Exception: config the process genuinely cannot run without — database URL, JWT secret, session store credentials — stays required. Put it in the boot-time assertion (`assertCoreEnv`) so a misconfigured deployment dies at startup where it is visible, never on the first request that happens to touch it.
> Corollary: when the default disables something, "not configured" and "configured but broken" look identical from the outside. If that distinction matters — monitoring is the obvious case, since a disabled heartbeat and a dead cron are indistinguishable — log once on the disabled path so the state is observable.
> Corollary: **the default keeps the deploy alive; it does not make the feature work.** Open a provisioning ticket in the same breath as the code change, because the two halves have different owners and different tools, and only the code half leaves a trace anyone reviews. Merged code reading an unprovisioned var is silently inert — the repo is green, CI is green, the PR is closed, and the feature simply never runs until someone happens to notice. Combined with the corollary above, this is the whole failure: a good default makes the missing config invisible, so the ticket is what makes it visible again. The ticket covers (a) set the var in the host, production **and** preview — a preview-only miss surfaces as "works on prod, broken in review apps" much later; (b) where a third party issues the value — a monitoring provider, an API vendor — extract it from that provider rather than inventing one locally, since a locally-invented secret authenticates nothing; (c) update the consuming service or monitor in the same change, so a newly added gate does not lock out the caller it was introduced to admit. Applies whether the var is required or optional.

## Python Coding Preferences

**Python Type Hints** — Static analysis and tool schema generation depend on complete annotations
> Pattern: Use Python 3.10+ union syntax (`str | None`, `int | list[str]`). Always annotate function parameters and return types. Use `Literal` for constrained string values. Use `dict[str, Any]` over bare `dict`.
> Avoid: `Optional[str]`, `Union[str, None]`, untyped function signatures, bare `dict` or `list` without type parameters.
> Example: `def get_model(model_id: int, environment: Literal["prod", "dev"]) -> dict[str, Any]:`

**Google-Style Docstrings** — Consistent documentation that tools and IDEs can parse
> Pattern: Use Google-style docstrings with `Args:` and `Returns:` sections on all public functions and tool functions. Keep the first line as a concise summary.
> Avoid: reStructuredText (`:param x:`), numpy style, or bare docstrings without structured sections.

**Python Import Ordering** — Clear dependency hierarchy
> Pattern: Group imports in this order, separated by blank lines: (1) stdlib (`os`, `threading`, `typing`) (2) third-party (`strands`, `httpx`, `pydantic`, `boto3`) (3) local (`src.config`, `src.http_client`).
> Avoid: Mixing import groups or using wildcard imports (`from module import *`).

**Error Returns Over Exceptions in Tool Functions** — Agent tools must never raise to the LLM
> Pattern: In `@tool`-decorated functions, catch exceptions and return `{"error": "..."}` dicts so the agent can reason about failures.
> Avoid: Letting exceptions propagate from tool functions — the agent framework may not handle them gracefully.

**Extract Compound Boolean Guards to Named Variables** — Double negations and multi-condition guards obscure intent; names make them readable at the call site
> Pattern: When a guard condition involves two or more negations, or combines unrelated predicates, extract it to a named boolean before the `if`. The name should express the decision, not the mechanics.
> Avoid: Inline compound negations like `if (!isCredits && !unlimitedPackage)` or `if (!a && !b && c)` that force the reader to mentally evaluate each clause to understand what is being guarded.
> Example: `const shouldSkipAcquire = !isCredits && !unlimitedPackage; if (shouldSkipAcquire) { ... }` — not `if (!isCredits && !unlimitedPackage) { ... }`

**Call Through an Authenticated CLI, Never Extract Its Credential** — when a script already depends on an authenticated CLI, reading that CLI's stored token to hand-roll an HTTP request re-implements auth badly: the read silently returns the wrong thing on config layouts you didn't test, and a refreshable (OAuth2) token goes stale out-of-band. Both failures land on whoever *isn't* the author — the machine where a stray env var happens to paper over the bug is the one it was written on.
> Pattern: POST/GET through the CLI's own API passthrough, which authenticates, refreshes, and resolves the host itself: `glab api <path> --method POST -H "Content-Type: application/json" --input -`, or `gh api`. Pipe the JSON body via stdin. Derive any host/project from the CLI's own metadata output rather than hardcoding it.
> Avoid: `glab config get token` / `gh auth token` feeding a `PRIVATE-TOKEN` header on a hand-built `urllib`/`requests`/`curl` call. Note `glab config get token` returns an empty string with **exit code 0** unless `--host` is passed, so `check=True` won't catch it.
> Example: `subprocess.run(["glab","api",path,"--method","POST","-H","Content-Type: application/json","--input","-"], input=json.dumps(payload))` — not `urllib.request.Request(url, headers={"PRIVATE-TOKEN": read_token()})`. `--input` without the explicit Content-Type header fails with `The provided content-type '' is not supported.`

## Authoring Rules and Docs

The compressed forms of these rules live in `rules/authoring-docs.md` (loaded when editing
Markdown files), not in `shared-rules.md`.

**Positive Phrasing Over Prohibition** — a prohibition has to name the forbidden behaviour to ban it, and naming it drags its tokens into context, making the behaviour *more* available at generation time, not less. A doc built from "don't/never" lines spends its whole budget describing exactly the outputs it wants to prevent, while the desired output is never once stated for the model to imitate.
> Pattern: State the target behaviour directly ("write one-line comments", "keep functions under a screen") so the banned alternative is never spoken. When a hard guardrail genuinely must be stated as a prohibition — a safety rule, a destructive command — pair it in the same sentence with the positive target, so attention lands on what to do rather than dwelling on what not to.
> Avoid: Steering style or structure through lists of "don't", "never", "avoid" with no accompanying positive instruction; rule files that read as an inventory of failure modes.
> Example: "Wrap every `if`/`for` body in braces, including one-line guards" — not "Never write braceless one-liners like `if (x) return;`". Both encode the same rule; only the first shows the shape to produce.

**Delete No-Op Instructions** — every sentence in an always-loaded doc pays rent in context tokens, and a sentence the model already obeys by default pays that rent for zero behaviour change. Worse than the waste: each inert line dilutes the lines that do change behaviour, so the doc as a whole steers less the longer it gets.
> Pattern: Test each line against "does this change behaviour versus what the model would do with no instruction at all?"; when the answer is no, delete the whole sentence rather than trimming words from it. When a line fails because its word is too weak to beat the default ("be thorough", "write good tests"), replace the weak word with a stronger one ("relentless", "adversarial") instead of adding more sentences around it.
> Avoid: Keeping lines because they sound wise or feel safe to leave in ("write clean, maintainable code", "consider edge cases"); fixing a weak instruction by elaborating it into a paragraph.
> Example: "Follow existing code conventions" is a no-op — the model does that unprompted; delete it. "Be thorough when reviewing" underperforms — replace with "Be relentless: assume every diff hides at least one bug until you've failed to find it", one strengthened sentence, not three qualifying ones.

**Leading Words Over Restatement** — one compact term the model already knows (tight, red, seam, tracer bullet) carries a whole bundle of behaviour in a token or two, and — unlike a sentence of description — repeats cheaply at every site where the behaviour applies. A doc that re-describes the concept at each site pays the full sentence cost every time, and the paraphrases drift apart until they read as three different rules.
> Pattern: Pick an existing term of art, define it once where it first appears, then repeat it as a bare token everywhere the behaviour applies — in the doc body, in headings, and in the pointer/description that triggers the doc, so the trigger and the body reinforce the same anchor.
> Avoid: Coining novel words that need a paragraph-long definition before they steer anything; spelling the same triad of properties out in full at three different sites instead of naming it once.
> Example: A testing doc defines "the seam" once — the injected boundary a test controls — then writes "mock at the seam", "assert through the seam", "a test reaching past the seam" throughout. Not: restating "the public boundary where external collaborators are injected" in each of those three sentences.

**Don't Cache What the Environment Answers** — a doc line restating `package.json` scripts, config values, or directory layout is a cache of a lookup the reader can always run, and it is a cache with no invalidation: the day someone renames a script, the doc is wrong and nothing fails. The lookup itself can't go stale, costs one file read, and is what the doc line would have had to be verified against anyway.
> Pattern: Document only what looking at the environment can't find — the unwritten convention, the *why* behind a surprising choice, the gotcha no config file confesses — and point at the authoritative file for everything mechanical.
> Avoid: Command lists ("run `npm run build` to build, `npm test` to test"), directory-layout maps, and config-value tables that duplicate one cheap lookup into a line that rots.
> Example: "Scripts are in `package.json`; note that `test` silently skips the integration suite unless the local DB container is up" — the pointer plus the gotcha the file can't show. Not: a bullet list enumerating every script name and what it does.

**Pointer Wording Decides Whether the Doc Gets Read** — an on-demand doc is only as good as the pointer that triggers loading it, and a weak pointer is a variance bug rather than a visible failure: some runs match it and get the guidance, some don't and silently proceed without it. The fix for "the doc wasn't followed" is usually the pointer, not more material inlined into the always-loaded file.
> Pattern: Front-load the trigger word so it matches early; state what the material *is* plus the distinct cases that should trigger reaching for it, one trigger per case, phrased in the words a task would actually contain. When a doc keeps being missed, sharpen its pointer before promoting its content into an always-loaded file.
> Avoid: Synonym piles that restate one trigger five ways while covering one case; pointers that spend their words on identity the doc body already carries ("this document describes...") instead of on when to load it.
> Example: "How to write rule files, review checklists, and CLAUDE.md-style docs" — three distinct trigger cases, trigger words first. Not: "Guidance and best practices for authoring, writing, and composing documentation" — five synonyms, one case, no distinct trigger a task would match on.

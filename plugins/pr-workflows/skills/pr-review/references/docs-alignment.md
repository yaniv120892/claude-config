# Documentation Alignment Check

Does the team's Notion documentation still describe the system after this diff
lands? Read-only — this check **never writes to Notion**.

## Where the docs live

Everything is under **Bazak R&D — Start here**
(`37541069-d180-801a-96ec-fee7ced3522a`). The sections that go stale:

| Section | Goes stale when the diff touches |
|---|---|
| System architecture | a service boundary, data flow, auth/tenant scoping, a data store's owner, a scheduled job |
| Design proposals and decisions | something a recorded decision said would work differently |
| Tenant capabilities | what a tenant agent can do, which supplier tools it has |
| Channels and customer experience | an MCP connector, a channel surface, the consent/sign-in flow |

## How to check

1. **Name the subsystem from the diff** — service, data store, boundary, agent,
   connector, or job. Not the file names.

2. **Search that subtree only**, so unrelated pages don't surface:

   ```
   notion-search({ query: "<subsystem>", page_url: "<root page id>", page_size: 5 })
   ```

   Run one search per distinct subsystem the diff touches. Usually one or two.

3. **Fetch only pages whose title plausibly covers the change.** A search hit is
   not evidence. `notion-fetch` the page and read what it actually claims.

4. **Compare claim against diff.** Drift is a *specific sentence, table row, or
   diagram edge* in the page that the diff makes false.

## What counts as drift

Report only when the page states something the diff makes **wrong**:

- A diagram edge that no longer exists, or a new one that is missing.
- A named owner, endpoint, table, queue, or env var that the diff renames or moves.
- A documented flow whose steps the diff reorders, removes, or short-circuits.
- A stated constraint ("X is read-only", "Y is per-tenant") the diff violates.
- A capability list that the diff adds to or removes from.

## What does not count

Do not report these. They generate noise and get the whole section ignored:

- The docs simply don't mention the change. Absence is not drift — a refactor
  with no observable behaviour change needs no doc.
- Wording you'd phrase differently.
- A page that is explicitly a proposal or a dated decision record. Those describe
  a moment, not current state; they go stale by design.
- Internal implementation detail the page deliberately abstracts over.

## Output

One row per drifted page, into section C of the review:

| Notion page + URL | what the diff contradicts | what to update |
|---|---|---|
| [System architecture](url) | "DAL is read-only for OS Platform" — `dal.booking.update()` at `src/x.ts:42` writes through it | Amend the DAL constraint, or the diff is wrong |

Quote the stale claim verbatim so the reader can find it on the page.

Pick exactly one closing line, by this test:

| You found | Write |
|---|---|
| A page covering the subsystem, nothing in it contradicted | `None` — name the page and the one thing it does claim, so the reader knows you read it |
| A page covering the subsystem at a higher altitude than the diff touches | `None` — same. A page that abstracts over the detail you changed is working as intended, not a gap |
| No page mentions the subsystem anywhere | `No page covers <subsystem>` |

The middle row is the common case and it is **not** a gap. Only claim a gap when
the search genuinely returned nothing about the subsystem.

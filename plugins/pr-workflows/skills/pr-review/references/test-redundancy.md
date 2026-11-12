# Test Redundancy Check

Does the diff add or change tests that repeat what the suite already proves?
Every test is paid for on every CI run, so a test earns its place by catching a
failure no other test catches. Read-only.

Read the target repo's CLAUDE.md first; its test layers, naming and runners
override anything generic here.

## Searching the head, not the checkout

The local clone's working tree is usually another branch. Search the PR head
without touching it:

```bash
git -C <clone> fetch -q origin pull/<n>/head
git -C <clone> grep -n -E '<pattern>' <head-sha> -- '<pathspec>'
```

No local clone → `gh search code '<pattern>' --repo <slug>` covers the default
branch only; say so in the closing line.

## The four questions

For each test added or changed in the diff, find the existing tests that touch
the same code, then ask:

### 1. Duplicate — is the behaviour already asserted at this level?

Search by what the test exercises, not by its name: the function or route under
test, the fixture it loads, a distinctive literal in its expectations. A
duplicate runs the same inputs through the same code and asserts the same
outcome as a test you can point at, in the diff or already on the base branch.

### 2. Layer — does a cheaper test already prove it?

Each layer should check what only it can. Flag an E2E, browser or integration
test that re-asserts logic a unit test already covers, when the only thing the
heavy test adds is a slower path to the same assertion. Keep the heavy test when
it proves wiring, rendering or a contract the lower layer cannot.

### 3. Merge — should these be one test?

- **Same body, different data** — copy-pasted tests differing by an input or
  expected value become one parameterized test (`test.each`, `it.each`,
  `pytest.mark.parametrize`, table-driven). Only when each case still reports
  its own name on failure and the loop carries no conditionals.
- **Same expensive setup, repeated** — several tests each paying for a server
  start, browser launch, build, DB seed or login to assert one scenario's
  steps. Share the setup (`beforeAll`, a fixture) or make them steps of one flow.
- Never merge the other way: one giant test with unrelated assertions hides
  which behaviour broke. Merge duplicates, not behaviours.

### 4. Cost — what does it add to every run?

Note what the new tests multiply: browser engines, viewports, locales, tenants
or fixtures in a matrix; fixed waits and sleeps; process or container startup;
a full build for one assertion. A test that multiplies the matrix has to justify
each cell. When CI durations are cheap to read (`gh run view <id> --json jobs`),
cite them; otherwise say the cost is estimated.

## What does not count

- A test that executes the same lines but asserts something different. Coverage
  overlap is not redundancy; a test is redundant only when deleting it loses no
  assertion. Name the assertion the other test carries.
- A regression test pinned to a past bug, a contract or schema test, and a test
  for an engine-, locale- or platform-specific behaviour.
- A test the PR's description says is deliberate, with a reason.
- A small unit test duplicated across files only by import-path coincidence.
- Tests of different failure classes that merely share a fixture.

## What a finding needs

The overlapping test's `path:line` at the head, the behaviour both assert, and
the one fix: delete, parameterize, share the setup, or move down a layer.
Prefer merging or moving down over deleting. Set no test-count target — the aim
is fewer repeated assertions, not fewer tests.

## Output

Return this section, nothing else:

````markdown
### I. Test redundancy — <owner/repo>#<n>
| tag | severity | file:line | comment |
| I1 | LOW | src/cart/cart.spec.ts:88 | Same input and assertion as `src/cart/cart.spec.ts:41`; fold into one `it.each` over both totals so each case still reports its own name. |
````

Severity: MEDIUM when the redundant test is slow or multiplies a matrix, or when
a behaviour change would force edits in several copies; LOW otherwise. Never
HIGH. Same comment form as `rubric.md`'s comment contract; a code fix goes in a
`suggestion` block below the table, tagged `I1`, `I2`….

Close with one line naming the test files compared and where you searched (head
SHA, whole repo or only the touched packages), or `None` when every new test
covers something no existing one does.

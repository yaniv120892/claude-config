# Package bump

For PRs whose primary change is **bumping a shared package version** (e.g. `@models/core.common.model`) and updating call-sites to use a newly exported type or value, skip the full structure and use this compact format instead:

```markdown
## Motivation

<One sentence: what was duplicated/missing and why the shared type fixes it.>

## Implementation

- **`<file>`** — <what it now imports/uses from the package, one bullet per file>.
- Bumps `<package>` to `<version>`.

## Proof of Work

Ran <the call site> locally against the bumped package:

```
<the command + its output, showing the new type/value in use>
```
```

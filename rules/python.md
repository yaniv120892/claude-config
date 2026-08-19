---
paths:
  - "**/*.py"
description: Python typing, docstring, import, and agent-tool conventions.
---

# Python

Read with `code.md`, which holds the language-agnostic rules.


**Type Hints** — 3.10+ unions (`str | None`), annotate all params and returns, `Literal` for
constrained strings, `dict[str, Any]` over bare `dict`. Avoid `Optional[X]`/`Union[X, None]`.

**Google-Style Docstrings** — `Args:` / `Returns:` sections on public and `@tool` functions,
concise first line. Avoid reStructuredText and numpy style.

**Import Ordering** — stdlib, third-party, local; blank line between groups. No wildcards.

**Error Returns Over Exceptions in Tool Functions** — `@tool` functions must never raise to the
LLM. Catch and return `{"error": "..."}` so the agent can reason about the failure.

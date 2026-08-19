# Express Backend Review

Use this for Express, Node.js backend, workers, API handlers, or service-layer changes.

## Mandatory Checks

- API contracts: request validation, response shape compatibility, status codes, backwards compatibility.
- Load: expected request volume, payload size, data scanned/read/written, pagination, batching, caching, rate limits.
- Data access: indexed queries, N+1 behavior, transactions, idempotency, race conditions, connection pool pressure.
- Security: authentication, authorization, tenant/user scoping, input validation, SSRF/path traversal/injection risks, secret handling.
- Reliability: timeouts, retries, cancellation, partial failures, dead-letter behavior for async flows.
- Observability: useful logs, metrics, tracing context, error classification without leaking sensitive data. Check label/field **values**, not just which metrics exist — an existing series whose label value changes is a silent break for every dashboard and alert keyed on the old value, and it deploys without any error.
- Tests: contract tests, service tests, edge cases, auth failures, load-sensitive query behavior where practical.

## Review Prompts

Ask these when the diff does not answer them:

- What is the expected calls-per-minute/hour/day for each changed endpoint?
- What is the upper bound on rows/artifacts/files/users processed per request?
- Does the endpoint need pagination, streaming, async processing, or caching?
- What happens when downstream services time out or return partial data?
- Could repeated requests create duplicates or inconsistent state?

## Findings To Prefer

Prefer findings that connect code to production impact:

- "This query can scan all user artifacts on every request; at 50k artifacts it will dominate p95 latency."
- "This accepts `userId` from the request body without verifying ownership, which can expose cross-user data."
- "This retry wraps a non-idempotent write and can duplicate records after a network timeout."
- "This changes `error_name` from the exception class name to the ErrorCode for every provider that carries one, not just the one this PR touches; alerts keyed on the old values go quiet after deploy with nothing failing."

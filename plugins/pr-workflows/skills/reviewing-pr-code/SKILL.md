---
name: reviewing-pr-code
disable-model-invocation: true
description: Not a review entrypoint. Holds the stack-specific review reference files that the pr-review skill reads.
---

# Review References

Reviewing happens in the **pr-review** skill. This directory exists for the
reference files it loads per stack:

| File | Read when the diff is |
|---|---|
| `references/express-backend-review.md` | an Express / NestJS / backend API |
| `references/nextjs-frontend-review.md` | Next.js or React |
| `references/code-smells.md` | any stack — the always-on smell baseline |

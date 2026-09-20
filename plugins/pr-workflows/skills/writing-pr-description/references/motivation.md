# Motivation


Answer: **Why does this change exist?** Write it for the product person reading the PR, not for the reviewer — they should get it on one read, without opening the diff and without asking what a word means.

**Length: 2–3 sentences. Hard cap.** The shape that fits in three: what someone hits today → what that costs → why it is worth fixing now.

- **Plain words.** "The upload fails for large files" rather than "the multipart ingestion path throws". A word that only makes sense to someone who has read the code belongs further down.
- **Spell out an acronym or drop it.** Ticket keys, enum values, class names, queue names, table names, feature-flag keys — all of it lives in Implementation.
- Name the cost of not shipping it. A motivation with no consequence in it is a summary.
- Reference the ticket only when it adds context a sentence cannot.

**Good example (from AIP-322):**
> Customers on the unlimited plan pay for fast image generations out of a separate balance. Today the service either rejects those customers outright or quietly spends their regular credits, so they lose money they already paid for. This change sends each request to the balance it belongs to, and falls back to the slower queue once the fast allowance runs out.

**Bad examples:**
- ❌ "Wires the routing layer so each `generationMethod` maps to its correct wallet operation, with graceful degradation to `unlimited_slow`" — accurate, and unreadable for the audience this section is written for
- ❌ "Added generationMethod support" — describes what, not why
- ❌ "As per AIP-339" — sends the reader off to find the ticket
- ❌ "This PR implements the package resolution feature" — circular
- ❌ A motivation naming six components and three design decisions — that is Implementation's job

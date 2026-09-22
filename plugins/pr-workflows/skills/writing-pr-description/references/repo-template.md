# Filling a repo's own PR template

Read once the `ls` in **The repo's own template wins** found a template. Its headings, wording and order are the description's shape; the section files are how each slot gets filled.

- **Keep its headings, their wording, and their order.** Also keep its checklists, and tick the boxes honestly.
- **A "Summary" or "TL;DR" slot wants one plain sentence of what the PR does**, in the Motivation's register. Opening it with file names puts the Implementation in the wrong box and leaves the reader no plain-language answer anywhere.
- **Replace the author instructions with the answer.** An HTML comment or a `<placeholder>` prompting for content goes away once the content is there.
- **A section with nothing to say keeps its heading and gets one honest line** ("No user-facing change — nothing to check after deploy"). Deleting a heading the team agreed on is overriding the template.
- **Add a heading of your own only for something the template has no home for** — usually the before/after run, or a file-by-file Implementation when the template has no What/Changes slot. Every template heading stays in its original order; your addition goes where a reader expects it, which is usually just before a trailing checklist.

The length budget, the plain-language Motivation, the one-bullet-per-file Implementation and the run-it-both-ways proof all still apply inside the template's sections. Only the headings and their order come from the repo.

`gh pr create --body` overwrites whatever GitHub would have pre-filled, so a template is only honored if it is read and filled in deliberately.

# UI Render Check

Does every changed screen still lay out correctly in a real browser? Typecheck,
lint, and jsdom tests cannot answer this — jsdom has no layout engine, so a card
clipped to half its content passes all of them. Read-only — never push fixes.

Read the target repo's CLAUDE.md first; its UI conventions (design system,
breakpoints, locales, how to run the app) override anything generic here.

## 1. Code read — always

Layout bugs live in the seam between a changed parent and the unchanged
components it renders, so read both sides of every seam:

1. List every component the changed JSX renders, imports from outside the diff
   included.
2. Open each one's source and note its root element's classes.
3. Set those beside the parent's classes at the point of use, and beside the
   siblings it renders next to.

A component left unopened is a seam left unchecked; name it in the closing line.
Flag:

| Pattern | Why it breaks |
|---|---|
| A reused component whose root uses `h-full`, `size-full`, `flex-1`, or a `%` height, in a parent that does not size it explicitly | Walk up the ancestors, through the page and layout shells, to the first definite height (`h-*`, `h-screen`, a flex/grid item stretched inside one). A shell's scroll area usually has one, so a "plain" column is rarely auto: the height resolves against that box and siblings shrink. Fine on the page it was built for, broken on the new one. |
| A flex child with `overflow-hidden` (card shells) beside a growing sibling | `overflow-hidden` drops its flex minimum size to 0, so it shrinks below its content and clips silently. |
| A new wrapper `div` between a parent and its children | A parent's `[&>*]:…`, `space-*`, `divide-*`, and grid/flex child rules reach direct children only: they now land on the wrapper, and the cards inside lose them (a shell's `[&>*]:shrink-0` stops protecting them). |
| Fixed `w-[…]`/`min-w-[…]` in px or rem | Overflows at ~400px. |
| Unbounded text (names, labels, numbers) with no `truncate`/`break-words`/`min-w-0` | Overflows its box with real data. |
| Formatting precision beyond the sample size, unaligned number columns | "71.43%" from 7 items is false precision; ragged columns need `tabular-nums` and a fixed width. |
| `left`/`right`/`ml`/`pl`/`text-left` where the app ships RTL | Mirrors wrong in Hebrew; use logical `start`/`end` (`ms`, `ps`, `text-start`). |

A code read finds seams; only a render clears them. Height resolution through
layout shells, flex minimum sizes, and `[&>*]` reach are where confident reasoning
goes wrong, so every seam matching the first three rows is a finding: measured
when section 2 rendered it, otherwise MEDIUM, worded "unverified — render to
confirm", naming the component, its root classes, and the parent chain.

## 2. Render — when the page can run

Find a URL serving the head commit: a preview, ticket-env, or dev URL in the PR
body, checks, or deployments; else start the app from the local clone with the
repo's dev script. Load each changed page headless (Playwright, or the cmux
browser), at 1440px and 400px wide, in each locale the app ships (EN and HE when
both exist). Then list every clipped or overflowing element in the changed area:

```js
[...document.querySelectorAll('main *')].filter(el => {
  const s = getComputedStyle(el);
  const clipsY = ['hidden', 'clip'].includes(s.overflowY) && el.scrollHeight > el.clientHeight + 1;
  const spillsX = !['auto', 'scroll'].includes(s.overflowX) && el.scrollWidth > el.clientWidth + 1;
  return clipsY || spillsX;
}).map(el => ({ cls: el.className, h: [el.clientHeight, el.scrollHeight], w: [el.clientWidth, el.scrollWidth] }))
```

Every hit is a finding with its measured numbers. Screenshot each changed state
and give the paths.

The page needs auth, data, or a URL you cannot reach → state exactly what blocked
the render and return the code-read findings. Never report the screen as fine
when it was not rendered.

## Worked example

A shared chart card's root is `flex h-full flex-col lg:min-h-[34rem]`. The sales
page puts it in a grid row with its own height; a new insights page put it in a
plain `flex flex-col` column beside two `overflow-hidden` cards. `h-full` took
the column's height and the siblings shrank: rate card 85px of 130px content,
table card 200px of 401px. Every test passed; prod looked broken. Fix: give the
chart a sized parent (`h-[34rem]`). The same page showed "71.43%" from 7 stops.

## Output

Return this section, nothing else:

````markdown
### U. UI render — <owner/repo>#<n>
| tag | severity | file:line | comment |
| U1 | HIGH | src/insights/page.tsx:42 | Rate card renders 85px of 130px content at 1440px EN: the `h-full` chart card beside it takes the column's height and this `overflow-hidden` card shrinks. Give the chart a sized parent. |
````

Severity: HIGH clips or hides content at a supported width or locale; MEDIUM
overflows or misaligns without hiding content; LOW is precision or polish. Same
comment form as `rubric.md`'s comment contract.

Close with one line: widths × locales rendered and the URL used, with the
screenshot paths — or what blocked rendering.

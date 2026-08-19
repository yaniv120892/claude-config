# Next.js Frontend Review

Use this for Next.js, React, app router, pages router, client/server component, UI, and frontend data-flow changes.

## Mandatory Checks

- Rendering stability: hydration mismatches, flicker, layout shift, unstable keys, browser-only logic during server render.
- Component boundaries: unnecessary `"use client"`, server/client prop serialization, duplicated fetching, avoid shipping server-only code to the client.
- Performance: bundle growth, expensive render paths, unnecessary re-renders, memoization only when justified, image/font loading, route-level caching.
- Data fetching: cache mode, revalidation, request deduplication, loading/error/empty states, stale data behavior.
- Accessibility: semantic elements, labels, keyboard access, focus management, color contrast, live regions when state changes.
- State management: avoid derived-state drift, global state for local concerns, race conditions in effects, cleanup for subscriptions/timers.
- User experience: no visible flicker between auth/loading/data states; avoid layout jumps and controls moving under interaction.
- Tests: component behavior, data-state transitions, accessibility-sensitive flows, regression tests for flicker-prone logic where practical.

## Review Prompts

Ask these when the diff does not answer them:

- Can this render differently on server and client?
- Is the loading state stable, or can it flash after data is available?
- Does this make a route or component client-rendered when server rendering would work?
- Does the data cache/revalidation behavior match product expectations?
- What happens on slow network, empty data, auth transition, and failed request?

## Findings To Prefer

Prefer findings that connect UI code to user-visible or runtime impact:

- "This reads `window` during initial render, so the server markup can differ from the hydrated client output."
- "The auth gate renders the empty state before the session finishes loading, causing a visible flicker."
- "Marking this layout as client-side ships all children through the client boundary and can increase bundle size unnecessarily."

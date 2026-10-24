# What changes

What a person sees differently after this PR, one bullet per behaviour, each tied to the
file that makes it happen. This sits in the visible part, so it is written for a teammate
from another repo, not for the reviewer.

````markdown
## What changes
- A guest who types `05/10-08/10, 2 adults` used to be blocked in the browser as an ID number; now the message goes through and the agent answers (`src/guard/pii.ts`).
- A card number is still blocked, but now by the server with a 422, so nothing is saved (`src/routes/messages.ts`).
````

- **2–4 bullets, one sentence each:** behaviour before → behaviour after → the file in backticks at the end.
- **Behaviour, not code names.** Say what the user, the caller, or the operator observes:
  a status code, what is shown, what is saved or logged. Class, function, enum and flag names
  stay in Implementation; the file path is the one code name allowed here.
- **Include the case that must not change** when there is one ("a card number is still blocked").
- **Every bullet is backed by Proof of Work.** A behaviour you could not observe says so
  (`not observed locally; see Verify on dev`) rather than stating what the code should do.
- **Before means the PR's base.** In a stack where nothing calls the new code yet, one bullet
  says so: "No visible change until #545 calls it (`src/guard/pii.ts`)."

# Code Smell Baseline

A generic review layer from Fowler's *Refactoring*, chapter 3. It applies to every diff, in any repo, on top of whatever the repo documents. Three rules bind it:

1. **The repo overrides.** A documented repo standard (rules files, `CLAUDE.md`, the review checklists) always wins; where it endorses something the baseline would flag, suppress the smell.
2. **Always a judgement call.** Each smell is a labelled heuristic ("possible Feature Envy"), never a hard violation. Report it as a suggestion and quote the hunk that triggered it.
3. **Skip anything tooling already enforces** (lint, typecheck, formatter).

## The Smells

Each smell reads *what it is* → *how to fix*. Match them against the diff:

- **Mysterious Name**: a function, variable, or type whose name does not reveal what it does or holds. → Rename it; if no honest name comes to mind, the design itself is murky.
- **Duplicated Code**: the same logic shape appears in more than one hunk or file in the change. → Extract the shared shape and call it from both places.
- **Feature Envy**: a method that reaches into another object's data more than its own. → Move the method onto the data it envies.
- **Data Clumps**: the same few fields or params keep traveling together — a type wanting to be born. → Bundle them into one type and pass that.
- **Primitive Obsession**: a primitive or string standing in for a domain concept that deserves its own type. → Give the concept its own small type.
- **Repeated Switches**: the same `switch`/`if` cascade on the same type recurs across the change. → Replace with polymorphism, or one map both sites share.
- **Shotgun Surgery**: one logical change forces scattered edits across many files in the diff. → Gather what changes together into one module.
- **Divergent Change**: one file or module is edited for several unrelated reasons. → Split it so each module changes for one reason.
- **Speculative Generality**: abstraction, parameters, or hooks added for needs the PR does not have. → Delete it; inline until a real need shows up.
- **Message Chains**: long `a.b().c().d()` navigation the caller should not depend on. → Hide the walk behind one method on the first object.
- **Middle Man**: a class or function that mostly just delegates onward. → Cut it and call the real target directly.
- **Refused Bequest**: a subclass or implementer that ignores or overrides most of what it inherits. → Drop the inheritance and use composition.

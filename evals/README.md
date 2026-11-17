# Behaviour evals

The owner's checks of what BookIt must always do, written in plain English. Each test's title is the behaviour,
word for word. They use a copy of BookIt the way a person would, with fixed test data and a fixed date (`EVAL_NOW`,
matching BookIt's test clock), so every run sees exactly the same days, times and screens.

Nothing runs them automatically: the owner switched them off in the Software Factory and in GitHub's checks on
17 November 2026. To run them yourself on a fresh copy (Docker needed):

```sh
bun run test:key-flows
```

Nobody changes, skips or removes an existing check without the owner's explicit yes. The owner is the code owner of
this folder (`.github/CODEOWNERS`).

Each check writes its steps with `step()` from `support.ts`, which screenshots the end of each step. A check that
changes shared state (a password, a clinic setting) puts it back before it ends.

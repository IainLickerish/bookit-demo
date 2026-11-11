# Behaviour evals

The owner's checks of what BookIt must always do, written in plain English. Each test's title is the behaviour,
word for word. They run against a demo copy of BookIt, the way a person would use it.

The Software Factory may add evals here, but it can never change, skip or remove an existing one without the
owner's explicit yes. The owner is the code owner of this folder (`.github/CODEOWNERS`).

The factory runs them on demo copies with fixed test data and a fixed date (`EVAL_NOW`, matching BookIt's test
clock), so every run sees exactly the same days, times and screens and any difference is a real change.

Run against a demo copy (Acme Physio, seeded accounts sharing one password):

```sh
EVAL_BASE_URL=http://localhost:4101 EVAL_MAIL_URL=http://localhost:8025 EVAL_PASSWORD=... \
  bun x playwright test -c evals
```

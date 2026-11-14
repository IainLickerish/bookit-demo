# Behaviour evals

The owner's checks of what BookIt must always do, written in plain English. Each test's title is the behaviour,
word for word. They run against a demo copy of BookIt, the way a person would use it.

The Software Factory may add evals here, but it can never change, skip or remove an existing one without the
owner's explicit yes. The owner is the code owner of this folder (`.github/CODEOWNERS`).

The factory runs them on demo copies with fixed test data and a fixed date (`EVAL_NOW`, matching BookIt's test
clock), so every run sees exactly the same days, times and screens and any difference is a real change.

These are BookIt's only browser checks of its user journeys. GitHub runs them too, in the required `test` check,
so they are also checked independently of the factory. To run them yourself on a fresh copy (Docker needed):

```sh
bun run test:key-flows
```

Each check writes its steps with `step()` from `support.ts`, which screenshots the end of each step for the owner's
storyboard. A check that changes shared state (a password, a clinic setting) puts it back before it ends.

The reminder checks use the already-running copy at `EVAL_BASE_URL` and its
inbox at `EVAL_MAIL_URL`, with the same `EVAL_PASSWORD` and `EVAL_NOW` as the
other checks. They never start services, access a database, advance the fixed
clock or invoke delivery directly. A fresh seed includes a free reference time
23 to 24 hours ahead when ordinary opening hours have none, so a client can book
it and observe the real worker's email without waiting a day.

The checks always cover the supplied Acme copy. If the runner also supplies
`EVAL_BEACON_BASE_URL` and `EVAL_BEACON_MAIL_URL`, the same checks cover Beacon
and compare isolation between the two copies. No second localhost service is
assumed. `scripts/key-flows.sh` supplies both copies for local runs. The
integration suite covers both UK clock changes, reminder window boundaries,
simultaneous workers, moves, cancellations, mail failures and saved settings in
separate databases. Browser checks observe repeated worker polls and follow
actual email links with signed-out, owning and other-client sessions.

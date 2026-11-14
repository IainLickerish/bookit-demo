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

The reminder checks run last and advance the disposable copies' shared demo clock
for the next two UK clock changes. Use `EVAL_NOW=2026-10-20T07:00:00.000Z` so both
changes fall within the seeded 220-day horizon. They wait for real worker polls,
read Mailpit emails and follow the links from those emails in both clinics.
`scripts/key-flows.sh` supplies both running clinics, their inboxes and the clock.

When driving copies that are already running, supply `EVAL_BASE_URL` and
`EVAL_MAIL_URL` for Acme, `EVAL_BEACON_BASE_URL` and `EVAL_BEACON_MAIL_URL` for
Beacon, the shared `EVAL_PASSWORD`, and `EVAL_CLOCK_FILE`, the writable host path
of the JSON clock mounted into both apps. `BOOKIT_CLOCK_DIR/clock.json` is also
accepted for the clock. The checks never start services, access a database or
invoke delivery directly. The clock only moves forwards, so run them on fresh
copies and discard those copies afterwards, rather than reusing them for another
suite. Clock advances expire earlier sign-ins; the journeys sign in again.

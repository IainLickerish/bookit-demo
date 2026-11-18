# BookIt demo

BookIt is a made-up appointment booking product for one made-up clinic, Acme Physio. It exists only to test the
Software Factory: nothing here is used by real people. All addresses end in `.test`; email goes to Mailpit. No real
client data or credentials belong in this repository.

## Checks

Use Node 24, Bun 1.4.4 and `bun.lock` (the only lockfile).

```sh
bun install --frozen-lockfile
bun run typecheck
bun run lint
bun run test:unit
```

The database tests (`bun run test:integration`) use the database in `BOOKIT_TEST_DATABASE_URL` when it is set, and
otherwise start their own with Docker. GitHub runs all four on every pull request (`.github/workflows/ci.yml`). Run
`bun run format` before committing.

## Run it locally

Create random test passwords in a private directory (the command never prints them and never replaces existing files),
then start the clinic with Docker Compose:

```sh
bun run local:credentials acme
export BOOKIT_CREDENTIALS_DIR="$PWD/test-results/local/acme"
export GIT_COMMIT="$(git rev-parse HEAD)"
export BOOKIT_TENANT=acme BOOKIT_PRODUCT=ACME BOOKIT_ENV=local
export BOOKIT_MAIL_FROM=noreply@acmephysio.test
export BOOKIT_PORT=4101 BOOKIT_MAIL_PORT=8025
export BOOKIT_PUBLIC_URL=http://localhost:4101
docker compose -p bookit-acme up --build -d --wait
```

Open <http://localhost:4101>. The accounts are `patient1@patients.acmephysio.test`,
`patient2@patients.acmephysio.test` (no phone number), `patient3@patients.acmephysio.test` and
`admin@acmephysio.test`; their passwords are in `accounts.json` in the credentials directory. Mailpit is at
<http://localhost:8025>. Compose migrates and seeds the database before starting the app; restarts keep bookings.

For working on the code against a local PostgreSQL database instead, set `DATABASE_URL`, then run
`bun run db:migrate`, `bun run seed` and `bun run dev`.

## Clinic settings and guides

The clinic's settings are in `tenants/acme.json`, and its user guide in `docs/user-guide/acme/`. The seed creates
Unicode patient names, a booking three hours after the seed time, and 09:00 to 17:00 slots for the next 220 days,
spanning the next UK clock change.

## Known faults, on purpose

BookIt contains faults that the Software Factory's test ideas fix: a late cancellation that is not saved, a bookings
download that fails for names with accents, and slot labels around the clock change. They are left in on purpose.
Article 08 of the user guide also keeps an old password-reset address on purpose.

# BookIt demo

BookIt is a fictional appointment booking product for SupportAgents. Acme Physio
and Beacon Dental have separate clinic databases, accounts and user guides.
All addresses use `.test`; confirmation mail goes to Mailpit. No real client data
or production credentials belong in this repository.

## Toolchain and checks

Use Node 24 LTS, Bun 1.4.4, Docker Engine with Compose, and a Linux host for container
tests. The only lockfile is `bun.lock`.

```sh
bun install --frozen-lockfile
bun run typecheck
bun run lint
bun run format:check
bun run test
bun x playwright install chromium
bun x playwright test
```

Vitest uses disposable PostgreSQL containers and local SMTP/Sentry fixtures.
Playwright also builds the Docker image and starts two isolated Compose projects
for the tenant journeys. First runs download pinned base images; tests never use
a live model, hosted Sentry or a real email service. Container test projects are
stopped afterwards, preserving their volumes and sanitised evidence for review.
Raw local test credentials remain private under ignored `test-results/` paths.

## Run one clinic locally

Create random test passwords in a private directory. The command refuses to
replace existing files and never prints passwords. Do this once for each new
clinic database. The account JSON maps every email in the tenant file to its
password; the two database files contain independent app and bootstrap passwords.
The directory has mode `0700` and its files are read-only (`0444`). This permits
rootless Compose's different container users to read their individual bind-mounted
secrets; other host users cannot traverse the private directory. The generator
refuses a directory accessible to other host users.

```sh
bun run local:credentials acme
export BOOKIT_CREDENTIALS_DIR="$PWD/test-results/local/acme"
export GIT_COMMIT="$(git rev-parse HEAD)"
export BOOKIT_TENANT=acme BOOKIT_PRODUCT=ACME BOOKIT_ENV=local
export BOOKIT_MAIL_FROM=noreply@acmephysio.test
export BOOKIT_PORT=4101 BOOKIT_MAIL_PORT=8025
export BOOKIT_PUBLIC_URL=http://localhost:4101
docker compose -p bookit-acme up --build -d --wait
docker compose -p bookit-acme ps --all
```

Open <http://localhost:4101>. The Acme accounts are
`patient1@patients.acmephysio.test`, `patient2@patients.acmephysio.test`,
`patient3@patients.acmephysio.test` and `admin@acmephysio.test`. Retrieve the matching
password privately from `accounts.json`; never paste it into an issue, log or prompt.
Mailpit is at <http://localhost:8025>. Patient 2 has no phone number.

To run Beacon alongside Acme, use a separate project, credential directory and ports:

```sh
bun run local:credentials beacon
export BOOKIT_CREDENTIALS_DIR="$PWD/test-results/local/beacon"
export BOOKIT_TENANT=beacon BOOKIT_PRODUCT=BEACON BOOKIT_ENV=local
export BOOKIT_MAIL_FROM=noreply@beacondental.test
export BOOKIT_PORT=4201 BOOKIT_MAIL_PORT=8026
export BOOKIT_PUBLIC_URL=http://localhost:4201
docker compose -p bookit-beacon up --build -d --wait
```

Open <http://localhost:4201> and <http://localhost:8026>. Beacon account local parts
are the same, with patients at `patients.beacondental.test` and the admin at
`beacondental.test`. Each project has an internal network, its own database and
log volumes, and a non-superuser database role. Database ports are not published.
Neither clinic is joined to the other's network. Local HTTP ports bind to loopback.
Only a small proxy with fixed BookIt and Mailpit destinations joins an additional
host-facing bridge; this makes published ports work with rootless Docker while
the application, database and SMTP stay on the internal clinic network.
The full SupportAgents staging/production network and dedicated staging bridge
wiring belongs to its M0-26 stack.

Compose migrates and seeds before starting the web server. Normal restarts preserve
bookings, settings and passwords. Repeating the seed returns `unchanged`; it does
not reset demo activity or rotate passwords. Selecting another tenant/environment,
changing the tenant seed configuration, or trying to adopt a nonempty unbound
database is refused. Use a new, separately named Compose project and fresh credential
directory for a fresh demo. Stop a project with `docker compose -p <project> stop`,
using that project's environment variables.

## Build and runtime configuration

`Dockerfile` requires the full 40-character `GIT_COMMIT`. `BUILD_ID`, `BOOKIT_IMAGE`
and `BUILT_AT` identify the build (`BUILT_AT` is an RFC 3339 UTC instant; when omitted,
the builder records its time). These are compiled into `/api/version`. The default
`BOOKIT_ALLOW_TEST_CLOCK=false` is the production/GHCR build setting. Image publishing
is reserved for default-branch CI; deployment is a documented human operation.

```sh
docker build --build-arg GIT_COMMIT="$(git rev-parse HEAD)" \
  --build-arg BOOKIT_ALLOW_TEST_CLOCK=false -t bookit-demo:local .
```

Runtime variables are listed by name in `.env.example`:

| Variable                              | Purpose                                                                                |
| ------------------------------------- | -------------------------------------------------------------------------------------- |
| `BOOKIT_ENV`                          | `local`, `staging` or `production`                                                     |
| `BOOKIT_PRODUCT`, `BOOKIT_TENANT`     | `ACME`/`acme` or `BEACON`/`beacon`; required container identity                        |
| `BOOKIT_PUBLIC_URL`                   | This clinic's public HTTP(S) origin, without a path, query or credentials              |
| `BOOKIT_DEPLOYMENT_ID`                | A new identifier for each deployment                                                   |
| `BOOKIT_SMTP_URL`, `BOOKIT_MAIL_FROM` | Local Mailpit connection and the tenant's `.test` sender                               |
| `BOOKIT_SENTRY_DSN`                   | Optional local receiver; unset sends no errors                                         |
| `BOOKIT_LOG_DIR`                      | JSON logs at `<dir>/<product lower>/<environment>.jsonl`; Compose mounts `/app/logs`   |
| `BOOKIT_TEST_CLOCK`                   | Mounted JSON clock file, accepted only by a test-clock build                           |
| `DATABASE_URL`                        | Database connection for source commands; the container derives it from its secret file |

Compose additionally consumes `BOOKIT_CREDENTIALS_DIR`, `BOOKIT_PORT`,
`BOOKIT_MAIL_PORT` and `BOOKIT_LOCAL_IMAGE`. The container reads
`BOOKIT_DB_PASSWORD_FILE`; the seed reads `BOOKIT_SEED_PASSWORDS_FILE`. Secret values
are mounted files, never build arguments. The seed password file is mounted only
into the seed service. No credentials are copied into an image.

Compose requires `BOOKIT_PUBLIC_URL` and passes it into the container. This prepares
the runtime contract added by password-reset PR #4, whose `.env.example` lists it;
that branch remains separate from this PR's base. Use each clinic's published local
origin as above, or its actual origin when configuring staging or production. The
password-reset implementation requires it outside local mode and never trusts the
request's Host header for email links. With `docker run`, pass it using `--env`.

For a local test-clock image set the build argument to `true`, then mount a file
such as `{"now":"2026-10-20T07:00:00.000Z"}` into the web and seed containers and set
`BOOKIT_TEST_CLOCK` to its container path. The seed uses that instant, the web server
reads clock advances, and request IDs use a counter. Production images refuse this
variable. Test-clock images refuse hosted Sentry DSNs. The Compose browser fixture
in `tests/helpers/compose.ts` shows the complete override with a local SDK receiver.

`GET /api/health` is liveness; `GET /api/version` includes product, tenant, environment,
commit, build and deployment identity. Container startup also checks the database's
seeded tenant/environment binding. Outside local mode the existing application
startup checks require the build commit and runtime identity.

## Source development and seeding

Point `DATABASE_URL` at a dedicated empty local PostgreSQL database. Supply the same
tenant/product/environment and password-file variables as above, then run:

```sh
bun run db:migrate
bun run seed
bun run dev
```

Passwords must be 12–256 characters and supplied for exactly the accounts in the
selected tenant file. The seed logs only tenant, environment, outcome and counts.
It creates Unicode patient bookings, a booking three hours after the seed instant,
and 09:00–17:00 local slots through the 220-day horizon, spanning the next London
clock change. Beacon has its distinctive practitioner marker for isolation tests.
`bun run slots:ensure` extends available slots later without resetting bookings.

## Guides and demonstration baseline

Coding agents fetch from `IainLickerish/bookit-demo` and push their work to the
machine-user fork, `iainlickerish-agent/bookit-demo`. Use `origin` for upstream
fetches and `fork` for pushes:

```sh
git remote add fork https://github.com/iainlickerish-agent/bookit-demo.git
git push -u fork <branch>
gh pr create --repo IainLickerish/bookit-demo --base main --head iainlickerish-agent:<branch>
```

Inspect and reuse an existing remote rather than overwriting it. Target upstream
`main` directly unless the parent PR is still open; explain that exception in the
description. The owner reviews and merges. Workflow files remain owner-only, and
fork workflow runs may need owner approval. Never add a bypass or token scope to
work around upstream branch protections. Reopen an existing upstream PR from the
fork only if the owner requests it.

The eight articles for [Acme](docs/user-guide/acme/01-getting-started.md) and
[Beacon](docs/user-guide/beacon/01-getting-started.md) cover booking, cancellation,
rescheduling, confirmations, administration, CSV export and accounts.
Tenant settings are in `tenants/acme.json` and `tenants/beacon.json`.

Article 08 intentionally retains `/account/reset-password` under the owner's
DEF-05 baseline instruction. The working password-reset route is owned by the
separate password-reset change. Expected fixes and deliberate-defect tests live
only in SupportAgents, outside this repository. BookIt's ordinary suite passes
without changing the Article 08 baseline.

The demonstration baseline also contains late-cancellation, non-ASCII CSV export
and clock-change slot-label defects. Their reproductions, expected fixes and
failing-then-passing tests live in SupportAgents under `demo/bookit-expected/`.
BookIt's ordinary tests exercise unaffected cancellation/export/display cases and
must pass both on this baseline and after each expected fix. The tenant seed keeps
its Unicode names and DST reference slots so those defects remain reproducible.

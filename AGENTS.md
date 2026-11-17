# BookIt: working conventions

Read this before changing BookIt. It holds the engineering conventions; the rest of BookIt's guidance is in:

- `docs/product.md`: what BookIt is, who it is for, what comes first and what it must never do.
- `docs/guides/look-and-feel.md`, `docs/guides/user-experience.md` and `docs/guides/writing.md`: how BookIt looks,
  behaves and reads. Follow them for anything people see.

Each rule has a short ID (EN-1 and so on) so a review can name it.

## What BookIt is

A booking product for clinics. Two clinics (tenants) share the code: Acme Physio (`tenants/acme.json`) and Beacon
Dental (`tenants/beacon.json`), each with its own database, accounts and words. Clients (patients) book, move and
cancel their own appointments; clinic staff see and export the clinic's bookings and change its settings.

## Stack

TypeScript (strict), Next.js App Router and React, Tailwind, PostgreSQL 17 with Drizzle, Zod for incoming values,
Nodemailer for mail, Pino for logs and optional Sentry for errors. One application serves every clinic.

- **EN-1** Keep changes within this stack unless there is a clear benefit from replacing part of it.

## Commands

Bun 1.4.4 and Node 24. Use these, and make them pass before you finish:

```sh
bun install --frozen-lockfile
bun run typecheck
bun run lint
bun run format:check
bun run test:unit
```

The unit tests need actionlint 1.7.12 on `PATH`, or its path in `ACTIONLINT`. The database tests
(`bun run test:integration`) use the database in `BOOKIT_TEST_DATABASE_URL` when it is set, and otherwise start their
own with Docker. The browser tests (`bun x playwright test`) need Docker; GitHub runs them on every pull request.

## Where things go

- Pages and form actions: `src/app/`. Booking, account and staff logic: `src/server/`. Shared helpers: `src/lib/`.
  Database schema: `src/db/`, migrations in `drizzle/`. Clinic settings: `tenants/`. Scripts: `scripts/`. Hosting:
  `infra/`. Tests: `tests/`; the owner's behaviour checks: `evals/`.
- Messages people see after an action: `src/app/messages.ts`. Booking refusals and their wording:
  `src/server/bookings/errors.ts`. Add new ones there, in the same style, rather than writing text inline.
- Styles: Tailwind, with BookIt's own classes in `src/app/globals.css` (`button`, `button-secondary`, `notice`,
  `alert`). Reuse them rather than adding one-off styles.
- Every element a test needs gets a `data-testid`.
- **EN-2** Put changes in their existing homes, and update the clinics' user guides (`docs/user-guide/`) when a change
  alters what clients or staff see or do.

## Coding rules

- Follow the existing names: hyphenated file names, `camelCase` functions, `PascalCase` components and types.
- Time: read "now" from the clock (`src/lib/clock.ts`), never `new Date()`, `Date.now()` or the database's own time
  (lint enforces it). Show times with `formatSlot` (`src/lib/time.ts`) in the clinic's time zone.
- Let unexpected failures reach the error handling, using `withoutQueryDetails` for database errors. Log with the
  shared Pino logger, with an event name and the request reference.
- Tenant words: use each clinic's own words (Acme: session, physiotherapist; Beacon: appointment, clinician).
- **EN-3** Reuse shared helpers and the patterns already here; delete what your change replaces. No features nobody
  asked for, no needless layers, no duplicated logic.
- **EN-4** Check who may see or change something on the server, not only by hiding links: a client only ever sees and
  changes their own bookings; only a clinic's staff see its bookings, exports and settings; clinics never see each
  other's data.
- **EN-5** Keep passwords, keys and private tokens out of code, images, logs, tests and fixtures. Never use real
  people's data or real email addresses: test addresses end in `.test`, and live databases, inboxes, logs or exports
  are never copied into tests, fixtures or evidence.

## Testing

- Vitest unit tests for calculations and validation; database tests for saved changes and requests that happen at the
  same time; Playwright browser tests for journeys, in both clinics. Use the fixed clock, repeatable fixtures and the
  local mail catcher.
- **EN-6** Prove each change with tests that fail without it and pass with it. Never delete, skip or weaken a test,
  including the owner's behaviour checks in `evals/` (see `evals/README.md`), to get a change through; change one only
  where the agreed request changes what it checks.

## Data changes

Change `src/db/schema.ts`, generate the migration with `bun run db:generate`, read it, and apply it with
`bun run db:migrate`. Compose migrates before starting the app. Test on an empty database and on one that already has
bookings. Prefer changes the previous version of the app still works with.

- **EN-7** Ship each database change as a new, tested migration, and never edit one that has been applied. Say in the
  pull request what it changes in stored data and how it would be undone.

## Packages

Direct packages have exact versions in `package.json`, and `bun.lock` is the only lockfile.

- **EN-8** Add a package only for a gap the existing tools cannot fill, at an exact version with `bun.lock` updated,
  under a permissive licence (MIT, BSD or Apache-2.0) unless the owner accepts another.

## Pull requests

- The owner reviews and merges every pull request. Deployment follows `docs/ci-and-deploy.md`.
- Do not change `.github/`: it decides how checks run, and changes to it are the owner's.

## Examples

Do: add a booking refusal to the shared error list, and test it. Don't: copy its wording into several pages.

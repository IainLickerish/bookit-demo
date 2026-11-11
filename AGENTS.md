# BookIt: working conventions

Read this before changing BookIt. It is short on purpose. The owner's guides in `docs/guides/` say how BookIt should
look, behave and read; follow them for anything people see.

## What BookIt is

A booking product for clinics. Two clinics (tenants) share the code: Acme Physio (`tenants/acme.json`) and Beacon
Dental (`tenants/beacon.json`), each with its own database, accounts and words. Clients (patients) book, move and
cancel their own appointments; clinic staff see and export the clinic's bookings and change its settings.

## Commands

Bun 1.4.4 and Node 24. Use these, and make them pass before you finish:

```sh
bun install --frozen-lockfile
bun run typecheck
bun run lint
bun run format:check
bun run test:unit
```

Integration and browser tests (`bun run test:integration`, `bun x playwright test`) need Docker.

## Where things go

- Pages: `src/app/` (Next.js App Router). Server logic: `src/server/`. Shared helpers: `src/lib/`. Database schema and
  migrations: `src/db/` and `drizzle/` (generate migrations with `bun run db:generate`; never edit an applied one).
- Messages people see after an action: `src/app/messages.ts`. Booking errors and their wording:
  `src/server/bookings/errors.ts`. Add new ones there, in the same style, rather than writing text inline.
- Styles: Tailwind, with BookIt's own classes in `src/app/globals.css` (`button`, `button-secondary`, `notice`,
  `alert`). Reuse them; do not add new colours or one-off styles.
- Every element a test needs gets a `data-testid`.

## Rules

- Reuse before you write. Delete what your change replaces. No features nobody asked for, no needless layers.
- Time: read "now" from the clock (`src/lib/clock.ts`), never `new Date()` or `Date.now()` directly (lint enforces it).
  Show times with `formatSlot` (`src/lib/time.ts`) in the clinic's time zone.
- Privacy: a client only ever sees their own bookings; only staff see the clinic's. Check this on the server, not only
  by hiding links.
- Tenant words: use the clinic's own words (Acme: session, physiotherapist; Beacon: appointment, clinician) where the
  page already does.
- Never put real people's data, real email addresses or secrets in code, tests or fixtures. Addresses end in `.test`.
- Tests with every change. Behaviour checks in `evals/` follow `evals/README.md`; never change or delete an existing one.
- Do not change `.github/`: it decides how checks run.

# Blocked-time data change and recovery

EN-6 requires tested migrations and a recovery plan. Migration
`0002_shallow_gwen_stacy.sql` adds
`blocked_period` and `blocked_cancellation` without altering existing columns or
booking rows. The first table stores the practitioner, start, end, optional
reason, creating staff account and creation time. The second links a saved block
to the bookings it cancelled. Existing data changes only when staff explicitly
confirm a block. Those bookings become cancelled, with the application clock's
cancellation time and no late-client-cancellation flag. Migration
`0003_remarkable_cammi.sql` adds an index for browsing saved blocks a page at a
time, without changing any records.

The integration checks cover a newly migrated database, upgrading a database
containing a confirmed booking, rollback after a cancellation-link write fails,
and concurrent blocks, bookings and moves in all 24 queued save orders. The race
checks verify that requests are waiting in PostgreSQL before releasing the diary
lock, then check saved blocks, cancellations and original bookings before any
follow-up confirmation. Both save orders of two overlapping blocks with separate
cancellations are checked too. The upgrade checks start with each clinic's
original configuration, frozen in `tests/fixtures/seed-baseline/`, on the
previous schema. They run the normal
`bun run db:migrate` and `bun run seed` commands and require an unchanged seed
result. They compare all existing bookings, accounts, slots, practitioners and
staff-edited settings and read each booking through the client booking query.
They also check that blocked time works after the upgrade. The rollback check
compares the booking and both new tables after a forced failure.

There is no automatic undo. Do not delete a saved block to undo its cancellations,
and do not restore bookings without checking for competing bookings and other
blocks. Rolling the application back alone leaves cancelled bookings cancelled
and the old application cannot enforce the blocks. Keep the clinic unavailable
while a developer performs recovery.

For a disposable demo, restore the whole pre-change database copy and run the
previous application. This loses activity recorded after that copy. For a copy
whose later activity must be retained, a developer must prepare a corrective
migration, preserve the block and cancellation records, reconcile every affected
booking against the current diary, then verify availability and booking status
before reopening. Never edit an applied migration. The new migration is additive;
no destructive recovery or live database change is performed by this build.

The shipped clinic configurations remain identical to the baseline, preserving
both seed fingerprints and existing activity. Extra fictional practitioners are
created only inside the isolated Compose browser test projects after normal
seeding. The unit checks compare both shipped configurations with the baseline
snapshots. Under EN-5 and PS-7, these fixtures contain made-up records only.
Existing demo databases do not need replacement or reseeding from scratch.

## Verification in this workspace

The required EN-2 runtime verification remains incomplete. There is no Docker
executable or socket in this workspace, and user namespaces are denied, preventing
rootless Docker setup. Integration and browser commands were run on this branch
and on an unchanged `sf-base` worktree. Both fail to start PostgreSQL checks and
browser journeys because there is no working container runtime. This does not
establish that those journeys pass.

The branch integration run reports 24 passed, 7 failed and 86 not run after
setup failures. The baseline reports 24 passed, 7 failed and 51 not run.
Comparing the reports shows identical suite and test outcomes for every existing
suite. The 35 additional blocked-time tests could not run because their database
setup failed. The two passing suites cover operational endpoints and start-up
refusals; they do not verify saved blocked time or concurrent diary changes.

The integration suites also encounter the missing `jq` tool in operational
script checks. Attempts to obtain it from GitHub and Debian were refused by the
workspace network proxy. Installing Chromium with system dependencies fails
because the workspace cannot become root; a browser-only download is also
refused by the proxy. No check was weakened to bypass these requirements.

Installation, type checking, lint, formatting and all 147 unit tests pass.
All 20 owner checks load successfully, including the three new checks. Owner checks are listed here, not executed, following
the factory's instruction to run them against its full, already-running demo.
Before merging, EN-2 requires a Linux environment with Docker, Compose, `jq` and
Chromium to pass the integration and browser suites and all owner checks. This
includes the corrected upgrade scenarios for both clinics. The recovery procedure
above has not been rehearsed in this workspace.

There are three new owner checks in `evals/10-blocked-time.eval.ts`. They cover
review and confirmation, reopening saved cancellations, access restrictions,
changed impact, retained invalid entries and stale booking and move screens.
Invalid-entry checks have been combined with the changed-impact journey, using
the original demo practitioner. The Compose browser journeys retain the extra
coverage for switching between two practitioners after repeated invalid reviews
in each clinic, using isolated fixtures. No owner check from `sf-base` is changed.

The blocked-time owner checks wait for the requested history page and selected
block before reading their details. This avoids comparing a reason read from
the previous page with a block opened on the next page during navigation. The
same checks still require the saved details and cancellation history to match.

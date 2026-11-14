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
time, without changing any records. Migration `0004_brave_ultron.sql` adds
`blocked_cancellation_block_idx` on `blocked_cancellation.block_id` for reopening
a block's cancellation history. It changes no records. All three migrations are
additive; no applied migration has been edited.

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

Saved cancellations are read 20 at a time, ordered by their session start and
booking reference. A continuation must belong to the selected block in the
current clinic. Invalid or unrelated references return the first page. The
confirmation still reviews and cancels the complete affected set, regardless of
page size. Integration checks require 41 cancellations to save together and remain
reachable across three pages, check equal start times, unrelated references and
the new index. Both clinics have browser journeys covering 21 cancellations,
reloading a later page, returning to the first page and keeping the history
position. The first new owner check books and cancels 21 sessions through the
normal client and staff screens, then follows every saved cancellation page.

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

Verification repeated on 14 November 2026, starting from commit `22b731a`,
with Node 24.22.2, Bun 1.4.4 and actionlint 1.7.12. The review covered the whole
step 1 change already on this branch. No further application or migration changes
were needed. A regression check now also covers a client cancelling after staff
review: the stale confirmation must save nothing, preserve that cancellation,
and require a fresh review before the block can be saved without attributing the
client's cancellation to the block. This follows EN-5 and acceptance criterion 5.

| Check                                                                           | Result                                                                                                                               |
| ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `bun install --frozen-lockfile`                                                 | Passed.                                                                                                                              |
| `bun run typecheck`                                                             | Passed.                                                                                                                              |
| `bun run lint`                                                                  | Passed.                                                                                                                              |
| `bun run format:check`                                                          | Passed.                                                                                                                              |
| `bun run test:unit`                                                             | All 147 tests passed.                                                                                                                |
| `node node_modules/@playwright/test/cli.js test -c evals/ --list --forbid-only` | All 20 owner checks loaded, including this branch's three new checks.                                                                |
| `bun run test:integration`                                                      | Failed: 24 passed, 7 failed and 88 unable to run after setup failures, before adding the extra regression case.                      |
| Focused blocked-time integration suite                                          | Failed during PostgreSQL setup: no working container runtime. All 38 cases were unable to run, including the added regression check. |
| `bun x playwright test`                                                         | Failed during PostgreSQL setup before any browser journey ran: no working container runtime.                                         |

Docker and Compose are unavailable in this workspace. The full integration suite
finished in 119 seconds; operational script tests also failed because `jq` is
missing. The 24 passing tests cover operational behaviour, not blocked time.
All 11 repository browser checks load with `--list --forbid-only`.
Container-backed tests
cannot verify the new tables, upgrades, rollback, simultaneous requests or
pagination here. No check was changed to bypass setup, skipped in source or
weakened to obtain a passing result. Vitest reports cases whose setup failed as
skipped; this does not mean those cases passed.

The factory owns execution of the owner checks against its prepared Acme copy,
with its fixed clock and fictional fixtures. They were listed here only, as
requested. Listing them confirms that all files load, but does not establish
that their browser journeys pass. EN-2 still requires passing runtime results
before merging, and the EN-6 recovery procedure above has not been rehearsed in
this workspace. No permission or additional test run is requested from the owner
by this build.

The three new owner checks cover review and confirmation, reopening saved blocks
and paged cancellations, access restrictions, changed impact, retained invalid
entries and stale booking and move screens. The original demo accounts and
practitioner remain unchanged. Repository browser journeys cover both clinics'
words, clinic separation and cancellation pages. Existing owner checks from
`sf-base`, their shared support file and `.github/` remain unchanged. Only this
branch's new blocked-time check was extended in earlier rounds to cover saved
block and cancellation pages; no owner check changed in this round.

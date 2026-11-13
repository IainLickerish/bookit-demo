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

Verification repeated on 13 November 2026, starting from commit `255ada3`,
with Node 24.22.2, Bun 1.4.4 and actionlint 1.7.12. The branch already contained
the cancellation pagination and index requested by the reviewer. This round
reviewed that implementation and reran checks; it made no further application,
migration or test changes.

| Check                                                                           | Result                                                                                   |
| ------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `bun install --frozen-lockfile`                                                 | Passed.                                                                                  |
| `bun run typecheck`                                                             | Passed.                                                                                  |
| `bun run lint`                                                                  | Passed.                                                                                  |
| `bun run format:check`                                                          | Passed.                                                                                  |
| `bun run test:unit`                                                             | All 147 tests passed.                                                                    |
| `node node_modules/@playwright/test/cli.js test -c evals/ --list --forbid-only` | All 20 owner checks loaded, including this branch's three new checks.                    |
| `bun run test:integration`                                                      | Failed: 24 passed, 7 failed and 88 not run after setup failures.                         |
| `bun x playwright test`                                                         | Failed in PostgreSQL setup before any browser journey ran: no working container runtime. |
| `bun x playwright install --with-deps chromium`                                 | Failed because dependency installation requires root access.                             |
| `bun x playwright install chromium`                                             | Failed after download attempts returned HTTP 403.                                        |

Docker and Compose are unavailable, no Docker socket is mounted, and creating a
user namespace fails with “Operation not permitted”. There is no local
PostgreSQL installation. These prevent running the unchanged container-based
checks here; no test has been weakened or marked to skip these requirements.
The owner checks were listed only, following the factory's instruction to leave
execution against its already-running copy to the factory. Listing checks does
not establish that a browser journey passes.

`bun run test:integration` completed in 127 seconds with a failing exit status.
All 37 blocked-time checks were unable to run because container setup failed,
including both clinic upgrades, forced rollback, concurrent requests and
cancellation pagination. The passing tests cover operational behaviour, not
blocked time. Operational script tests also fail because `jq` is missing. The
previous round recorded matching infrastructure failures in an unchanged
`sf-base` worktree; this round does not claim those failures verify the new work.
All 11 repository browser checks also load with `--list --forbid-only`, but none
ran. The existing owner checks and `.github/` remain identical to `sf-base`.

Before approval or merging, EN-2 still requires passing integration and browser
suites in an environment with Docker, Compose, `jq` and Chromium, plus execution
of the owner checks by the factory. EN-6 also requires checking recovery in that
environment. Neither migration safety, atomic cancellation nor simultaneous
request safety has been verified against PostgreSQL here. Both clinic upgrades,
forced rollback, all 24 concurrent save orders and every cancellation page still
need passing runtime results. The recovery procedure above has not been
rehearsed in this workspace. This verification gap remains an approval blocker.

The three new owner checks cover review and confirmation, reopening saved blocks
and paged cancellations, access restrictions, changed impact, retained invalid
entries and stale booking and move screens. The original demo accounts and
practitioner remain unchanged. The Compose journeys also cover both clinics'
words and retaining the chosen practitioner through repeated invalid reviews.
No owner check from `sf-base` has changed. Only this branch's new blocked-time
check has been extended to cover cancellation pages.

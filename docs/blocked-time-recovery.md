# Blocked-time data change and recovery

This change follows EN-6. Migration `0002_shallow_gwen_stacy.sql` adds
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
cancellations are checked too. The upgrade check compares the
existing booking before and after migration. The rollback check compares the
booking and both new tables after a forced failure.

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

## Verification in this workspace

Type checking, lint, formatting, all 145 unit tests and listing all 20 owner
checks passed. The PostgreSQL integration suite was attempted but could not
start because this workspace has no container runtime. The integration and
browser journeys still need to run in the factory's full demo environment
before merging, as required by EN-2. Owner checks were listed here, not run.

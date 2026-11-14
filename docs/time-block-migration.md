# Blocked-time data change and recovery

Migration `0002_tricky_albert_cleary.sql` adds `time_block`, linked to the clinic's
practitioners. It stores start and end as absolute instants, an optional reason
(up to 500 characters), and the creation time. It does not rewrite bookings, slots,
accounts or settings. Each clinic keeps its own table in its existing database.

Normal deployment applies the new migration before starting the application, as
required by EN-6. The previous application can still read the upgraded database,
but it does not enforce blocks. Do not resume client bookings on that version
while blocks are needed. Keep the application unavailable until the current
version is restored and availability is checked.

For a mistaken block, an authorised operator can remove just that block by its
reference in the correct clinic's database, in a transaction. First save a private
copy of that row in a clinic-approved location, check the practitioner and times,
then delete only the matching row and verify that availability is restored. The
private copy can be reinserted to undo the deletion. Never delete bookings or
slots to remove a block. There is no deletion control in this change.

Integration coverage applies migrations to an empty database and upgrades the previous
schema containing bookings. It verifies every stored booking field remains unchanged,
and rehearses removing and restoring a mistaken block without affecting bookings.
The added migration contains only table creation, its foreign key and index;
no existing records are updated or dropped.

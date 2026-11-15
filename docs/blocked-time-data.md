# Blocked time data and recovery

The new migration adds `practitioner_block` to each clinic's own database. Each row
holds a practitioner reference, start and end instants, an optional reason of up
to 500 characters and the application clock's creation time. No existing table or
booking is changed. Overlapping periods are allowed and their combined time stays
unavailable. Periods persist through seeding and through future slot generation.

The integration tests cover a fresh migration, upgrading the previous schema with
saved bookings, and recovery of a mistaken period. They also check that booking
and blocking at the same time either refuses the booking or includes it in the
staff warning. Both writes lock the same practitioner before checking availability.
Moving locks the target practitioner before the booking to keep that order consistent.

To recover a mistaken period, an authorised operator first records its ID, times
and reason privately, verifies the clinic and practitioner, then deletes only that
row from that clinic's `practitioner_block` table in a transaction. Check that the
period is gone and the expected unbooked times are offered again before committing.
Existing confirmed bookings must stay unchanged. Retaining the recorded row allows
it to be restored if the wrong period was selected. No removal screen is included
in this change.

Keep the additive table if reverting application code. The previous application
does not enforce blocked periods, so pause booking access before reverting and
resolve any saved periods before reopening it. Do not drop the table or edit an
applied migration as a recovery shortcut.

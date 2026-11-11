# Blocked time

Clinic staff can record a practitioner's holiday, training or other absence.
Sign in as an administrator, open **Admin**, then choose **Blocked time**.
Choose a practitioner, enter the start and end in the clinic's time zone and,
if useful, add a reason. Choose **Block time** to save it.

Clients cannot book or move an appointment into any part of that period.
This also applies if they opened the booking choices before staff saved the
absence. Other practitioners and appointments outside the period stay available.

If confirmed bookings overlap the absence, the saved period shows a warning
listing the clients, appointment times and contact details. Staff must contact
those clients to arrange what happens next. Saving an absence does not cancel
or move their bookings.

Saved periods appear most recently saved first, with up to 20 on each page.
Use **Next page** and **Previous page** to browse them. Choose **Remove blocked
time** to make any otherwise available appointments in that period bookable
again. This does not change existing bookings.

## Stored data and undoing the change

This feature changes the database structure. Migration
`drizzle/0002_parallel_salo.sql` adds the `blocked_period` table, defined in
`src/db/schema.ts`. It stores the practitioner, start, end, optional reason and
creation time for each saved absence. Existing bookings are kept unchanged.

Staff can remove individual absences on the Blocked time page. Removing the
feature and its table needs a developer. Before reverting it, the developer
should back up saved absences, return the application to a compatible version,
remove the table and reconcile the migration history. Reverting the application
code alone does not undo the database change. This can be tried safely in the
demo copy; applying it to the live clinic changes its database structure.

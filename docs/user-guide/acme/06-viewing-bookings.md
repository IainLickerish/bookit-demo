---
id: '06'
tenant: acme
title: Viewing bookings
audience: admin
---

# Reviewing Acme Physio bookings

Sign in with the Acme clinic admin account and open **Clinic bookings** at `/admin`.
Filter by **physiotherapist**, date or booking status, then apply the filters.
Dates refer to the clinic's Europe/London calendar day. Clear a filter to widen
the view; an empty list means no appointments match the current selection.

The table includes patient names and booking status. Only authorised Acme clinic
staff should use this page. Patients see their own appointments through **My bookings**.

## Blocking out time

On **Clinic bookings**, choose **Block out time**. Select a physiotherapist, enter the
start and end in the clinic's displayed time zone, and add a reason if useful
(up to 500 characters). Check the details, then choose **Save block**.
The end must be after the start. Times skipped or repeated when the clocks
change cannot be used: choose another time. If there is an error, your entries
stay in the form so you can correct them.

Clients cannot book any session that overlaps the saved block, even partly.
A session ending exactly when the block starts is still available.
A session starting exactly when the block ends is blocked and included in
the warning if already confirmed. Blocks may cover several days and may overlap each other.

**Saved time blocks** shows the times and reason. If confirmed bookings overlap,
you see a warning with the clients' names, email addresses, phone numbers where
provided, times and booking references. Contact those clients to arrange another
time. Their bookings are not cancelled or changed automatically. Cancelled
bookings are not included in the warning. Only your clinic's staff can see blocks,
reasons and affected booking details. Saved blocks remain listed when you return;
the warning updates if a booking is moved or cancelled.

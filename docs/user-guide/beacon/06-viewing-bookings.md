---
id: '06'
tenant: beacon
title: Viewing bookings
audience: admin
---

# The Beacon Dental bookings list

Use the Beacon admin account to sign in, then open **Clinic bookings** at `/admin`.
Choose a **clinician**, date or status and apply the filters. The date follows
Europe/London time. If no bookings appear, clear a filter or select another day.

The table shows patient names and booking status. Keep access to authorised
Beacon staff. Patient accounts use **My bookings** to view only their own dental
appointments and cannot open the clinic admin list.

## Blocking out time

On **Clinic bookings**, choose **Block out time**. Select a clinician, enter the
start and end in the clinic's displayed time zone, and add a reason if useful
(up to 500 characters). Check the details, then choose **Save block**.
The end must be after the start. Times skipped or repeated when the clocks
change cannot be used: choose another time. If there is an error, your entries
stay in the form so you can correct them.

Clients cannot book any appointment that overlaps the saved block, even partly.
An appointment ending exactly when the block starts is still available.
An appointment starting exactly when the block ends is blocked and included in
the warning if already confirmed. Blocks may cover several days and may overlap each other.

**Saved time blocks** shows the times and reason. If confirmed bookings overlap,
you see a warning with the clients' names, email addresses, phone numbers where
provided, times and booking references. Contact those clients to arrange another
time. Their bookings are not cancelled or changed automatically. Cancelled
bookings are not included in the warning. Only your clinic's staff can see blocks,
reasons and affected booking details. Saved blocks remain listed when you return;
the warning updates if a booking is moved or cancelled.

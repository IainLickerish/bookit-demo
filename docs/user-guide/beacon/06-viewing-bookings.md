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

## Blocking time at Beacon Dental

1. Sign in with your clinic staff account and open **Clinic bookings**.
2. Choose **Block out time**, then choose the clinician.
3. Enter **Start** and **End** in the clinic's displayed time zone, using 24-hour times. You can span several days.
4. Add a **Reason (optional)**, up to 500 characters, then choose **Save blocked time**.
5. Check the saved block and its warning. Contact every listed client to arrange another appointment. Existing bookings remain confirmed and are not moved or cancelled.

A block with no affected bookings says **No confirmed bookings overlap this blocked time.**
Clients cannot see blocks or reasons. Any appointment that overlaps a block is unavailable to book or move into.
A appointment ending exactly at the start, or starting exactly at the end, can still be booked.

If a field needs correcting, the page keeps the other entries. Starting another save clears the previous success message; a failed save shows its error instead. Times skipped when UK clocks go forward,
or repeated when they go back, cannot be entered as an endpoint. Choose a time before or after that hour.
A block spanning a clock change keeps the start and end you entered. Saved times remain fixed if the clinic later changes its time zone.

Use **Back to clinic bookings** to return to the diary. Only Beacon staff can use this page.

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

## Blocking time at Acme Physio

1. Sign in with your clinic staff account and open **Clinic bookings**.
2. Choose **Block out time**, then choose the physiotherapist.
3. Enter **Start** and **End** in the clinic's displayed time zone, using 24-hour times. You can span several days.
4. Add a **Reason (optional)**, up to 500 characters, then choose **Save blocked time**.
5. Check the saved block and its warning. Contact every listed client to arrange another session. Existing bookings remain confirmed and are not moved or cancelled.

A block with no affected bookings says **No confirmed bookings overlap this blocked time.**
Clients cannot see blocks or reasons. Any session that overlaps a block is unavailable to book or move into.
A session ending exactly at the start, or starting exactly at the end, can still be booked.

If a field needs correcting, the page keeps the other entries. Times skipped when UK clocks go forward,
or repeated when they go back, cannot be entered as an endpoint. Choose a time before or after that hour.
A block spanning a clock change keeps the start and end you entered. Saved times remain fixed if the clinic later changes its time zone.

Use **Back to clinic bookings** to return to the diary. Only Acme staff can use this page.

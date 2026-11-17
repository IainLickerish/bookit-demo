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

In **Clinic bookings**, choose **Block out time**. Choose the physiotherapist,
then enter **Start** and **End** in the clinic's displayed time zone. The end must
be after the start. Add a **Reason (optional)** if useful, then choose
**Save blocked time**. Check the saved name, period and reason below the form.
Times skipped or repeated during a clock change cannot be used; choose an
unambiguous time before or after the change.

Clients cannot book or move into any session that overlaps the blocked period.
A session ending exactly at its start, or starting exactly at its end, remains
available. Existing bookings stay confirmed. A warning under the saved period
lists any overlapping confirmed bookings with the client's name, time and booking
reference. Contact those clients to arrange another time. Only this clinic's staff
can see blocked periods, reasons and affected bookings.

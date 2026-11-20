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

## Block out time

In **Clinic bookings**, choose **Block out time**. Select the physiotherapist and enter the start and end in the
clinic's time zone. Add a reason if you wish, then choose **Save time block**.
If the clinic's time zone changes while the form is open, check the dates and times in the updated zone before saving again.

Clients cannot book or move a session into any time that overlaps the block. If confirmed bookings overlap it,
the warning lists each client's name and session time. The bookings stay confirmed. Contact the clients listed
to arrange what happens next.

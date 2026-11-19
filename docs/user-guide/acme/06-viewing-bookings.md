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

## Blocking time for a physiotherapist

1. Open **Block out time** on **Clinic bookings** and choose the physiotherapist.
2. Enter the start and end in the clinic’s time zone. You can add a reason for staff.
3. Choose **Review block**. Check the period and any confirmed bookings listed, including the client names and session times.
4. Choose **Save block**. Clients will no longer see times that overlap the block when they book or move a session.
   Existing bookings stay confirmed. Contact the clients listed to rearrange their sessions.

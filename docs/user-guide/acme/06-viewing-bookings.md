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

## Blocking time when a physiotherapist is away

1. From **Clinic bookings**, choose **Block time**.
2. Choose the physiotherapist and enter the start and end in the clinic’s time zone. You can add a short reason.
3. Choose **Review time block**. If existing bookings overlap, check the client contact details and session times.
4. Choose **Save time block**. Clients can no longer choose sessions that overlap that time. Any existing bookings
   stay confirmed, so contact the clients listed in the review to arrange what happens next.

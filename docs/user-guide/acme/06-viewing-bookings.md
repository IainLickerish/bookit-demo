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

In **Clinic bookings**, select **Block out time**. Choose a physiotherapist
and enter the start and end dates and times in the clinic’s time zone. You can
add a reason if you wish. Select **Save block-out**.

Patients cannot choose a time that overlaps the block-out. If any confirmed
bookings overlap, the warning lists the patients and their session times.
Those bookings stay confirmed. Contact the patients to arrange a new time.

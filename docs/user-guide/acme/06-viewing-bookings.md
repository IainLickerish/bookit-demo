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

## Blocking out time when a physiotherapist is away

Open **Practitioner time off** from the link at the top of **Clinic bookings**
(`/admin/time-off`). Choose the physiotherapist, a start and an end in Europe/London
time, and optionally a reason such as holiday, training or sick day. The reason is
for staff only; patients never see it.

From then on, patients are not offered any session that overlaps that time, and
cannot book or reschedule into it. Sessions already booked in that time are **not**
cancelled. Instead the page warns you and lists each one with the patient's name,
email and phone number so you can contact them. The warning stays on the page until
the time off has ended. If time off was entered by mistake, choose **Remove this
time off** and those sessions can be booked again.

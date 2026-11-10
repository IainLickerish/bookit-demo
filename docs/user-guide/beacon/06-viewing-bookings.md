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

## Blocking out time when a clinician is away

From **Clinic bookings**, open **Practitioner time off** (`/admin/time-off`). Pick the
clinician, a start and an end (Europe/London time) and, if you like, a reason such as
holiday, training or sick day. Only staff can see the reason.

Patients are then not offered any appointment that overlaps that time, and cannot
book or reschedule into it. Appointments already booked in that time are **not**
cancelled: the page shows a warning listing each patient's name, email, phone number
and appointment time so the team can contact them. The list stays visible until the
time off ends. To undo a mistake, choose **Remove this time off**.

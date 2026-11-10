---
id: '05'
tenant: acme
title: Confirmation emails
audience: patient
---

# Your Acme Physio confirmation

Booking and rescheduling confirmations are sent from `noreply@acmephysio.test`.
They describe the physiotherapist, appointment date and local time. Acme includes
contact details when available; providing a phone number is optional.

## Appointment reminders

About 24 hours before your appointment you receive one reminder email with the
date, the time in UK time and your physiotherapist. It has links to reschedule or
cancel: each opens a page in BookIt, after you sign in, where you confirm the
change. If you move your appointment before the reminder is sent, the reminder
is for the new time. Cancelled appointments get no reminder. Clinic staff can
switch reminders on or off in **Clinic settings**.

In this fictional demonstration, email is delivered to the local Mailpit inbox,
not to a real email service. **My bookings** at `/bookings` is the place to check
your current appointment status if an email is missing. Ask Alice Archer at
`alice@acmephysio.test` for clinic assistance.

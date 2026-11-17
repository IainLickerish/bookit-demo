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

In this fictional demonstration, email is delivered to the local Mailpit inbox,
not to a real email service. **My bookings** at `/bookings` is the place to check
your current appointment status if an email is missing. Ask Alice Archer at
`alice@acmephysio.test` for clinic assistance.

## Reminder emails

When the clinic has reminders switched on, an unchanged confirmed session booked
at least 24 hours ahead receives one reminder about 24 hours before its start.
The reminder shows the clinic, day, date, 24-hour local time and physiotherapist.
Its reschedule and cancel links take you to **My bookings**, where you must sign in
to your own account before making a change. Opening a link does not change a booking.

Cancelled bookings and bookings made less than 24 hours ahead receive no reminder.
If a reminder is missing, check **My bookings** for your current session details.

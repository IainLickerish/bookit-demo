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

## Session reminders

When reminders are on, you receive one email about 24 hours before your
session if you booked or moved it at least 24 hours ahead. The email gives
the session date, local time and physiotherapist. Both links take you to that
session in **My bookings** after signing in, where you can reschedule or cancel.
If you move your session before the reminder is due, it uses the new time.

In this fictional demonstration, email is delivered to the local Mailpit inbox,
not to a real email service. **My bookings** at `/bookings` is the place to check
your current appointment status if an email is missing. Ask Alice Archer at
`alice@acmephysio.test` for clinic assistance.

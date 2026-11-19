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

## Session reminders

When reminders are on, Acme Physio sends a reminder about 24 hours before a
confirmed session. Book or move the session at least 24 hours ahead to receive a
reminder. Each booking can receive one reminder. The email gives the date,
clinic time and physiotherapist. Follow **Reschedule your session** or
**Cancel your session** and sign in if asked. Opening either link leaves your
booking in place until you act.

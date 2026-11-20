---
id: '05'
tenant: acme
title: Confirmation and reminder emails
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

When Acme Physio has reminders switched on, you receive one email about 24 hours
before your confirmed session. If you book within 24 hours, it may arrive sooner
after you book. The email shows the date, UK time and your physiotherapist.

Use the reschedule or cancel link and sign in if asked. The cancel link takes you
to that session in **My bookings**. If you move your session before the reminder
is sent, it follows the new time. If a reminder has already been sent, you will
not receive another for the same booking.

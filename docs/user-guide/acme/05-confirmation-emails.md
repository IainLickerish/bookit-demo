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

When the clinic has reminders switched on, you receive one reminder about 24 hours
before your session. It shows the date, UK time and physiotherapist, with a link
to **My bookings** to reschedule or cancel after signing in. Cancelled bookings
get no reminder. If you move before the reminder is sent, it uses your new time
and physiotherapist. A booking that has already had its reminder does not get another.

If reminders are switched off when yours is due, it is skipped. Switching them
on later does not send a reminder for the same booking time.

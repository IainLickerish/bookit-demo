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

When session reminders are on, Acme Physio sends one email for each confirmed
session, usually around 24 hours before it starts. It shows the date, UK time
and physiotherapist. Use the reschedule or cancel link in the email, then sign
in to manage that session. If you move a session before its reminder goes out,
the reminder uses the new time. Check **My bookings** for your current details.

In this fictional demonstration, email is delivered to the local Mailpit inbox,
not to a real email service. **My bookings** at `/bookings` is the place to check
your current appointment status if an email is missing. Ask Alice Archer at
`alice@acmephysio.test` for clinic assistance.

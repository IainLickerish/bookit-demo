---
id: '05'
tenant: acme
title: Confirmation emails
audience: patient
---

# Your Acme Physio confirmation

Booking confirmations are sent from `noreply@acmephysio.test`.
They describe the physiotherapist, appointment date and local time. Acme includes
contact details when available; providing a phone number is optional.

In this fictional demonstration, email is delivered to the local Mailpit inbox,
not to a real email service. **My bookings** at `/bookings` is the place to check
your current appointment status if an email is missing. Ask Alice Archer at
`alice@acmephysio.test` for clinic assistance.

## Reminder emails

When the clinic enables reminders, your upcoming confirmed session can
receive one reminder within 24 hours of its start. It shows the clinic, current
physiotherapist, UK day, date and 24-hour time, including clock changes.
Cancelled or started bookings receive no reminder.

Follow **Reschedule** or **Cancel** to sign in and review that booking’s current
details. Opening a link never changes the booking. You confirm any move or
cancellation on the review page, with a way back to keep your booking. Another
client cannot use your links to see or change it.

A move made before any reminder attempt uses the new time. Once sending has been
attempted, the booking receives no further reminder, even after a move or an
uncertain delivery result. Always check **My bookings** for the saved result.

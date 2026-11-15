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

When the clinic has reminders switched on, you receive one reminder around
24 hours before your session. It shows the clinic, UK date and time, and your
physiotherapist. Sign in with your clinic account to use the reschedule link, or open
**My bookings** from the cancel link and choose **Cancel** on your session.
The links do not cancel or move a booking by themselves.

A cancelled booking receives no reminder. If you move before receiving a reminder,
it follows the new time. Once a booking has had its reminder, moving it does not
send another. A booking made less than 24 hours ahead receives its reminder shortly
after booking. If delivery fails, check **My bookings**; reminders are not sent again.

Clinic staff can open **Clinic settings**, change **Send booking reminder emails**
and choose **Save settings**. Reminders start switched on. Switching them off stops
unsent reminders for this clinic. Switching them back on allows reminders for
upcoming bookings that have not had a delivery attempt.

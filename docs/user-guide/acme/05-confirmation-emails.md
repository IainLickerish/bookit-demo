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

Booking and move emails include a `booking.ics` calendar file with the clinic,
physiotherapist, date, time and session length. Open it in Google Calendar, Outlook
or Apple Calendar. The calendar shows the correct UK time when set to Europe/London;
if you travel, your calendar may show the equivalent local time.

If email delivery fails, your session remains saved. You can still choose
**Add to calendar** beside it in **My bookings**. Calendar entries are copies, so
replace the old entry after a move and remove it yourself after cancelling.

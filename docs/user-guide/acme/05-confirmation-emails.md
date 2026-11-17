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

Each booking or move confirmation includes a `booking.ics` calendar file with the
saved session details. Import it into Google, Outlook or Apple Calendar. The file
keeps the correct UK time through clock changes. Your calendar may display it in
your device's time zone, so choose UK time if you are travelling.

After moving a session, import the new file and check that your calendar shows the
new time. Remove an old entry if your calendar creates a duplicate. Calendar entries
do not update automatically when you move or cancel. **My bookings** always shows
your current session details.

In this fictional demonstration, email is delivered to the local Mailpit inbox,
not to a real email service. **My bookings** at `/bookings` is the place to check
your current appointment status if an email is missing. Ask Alice Archer at
`alice@acmephysio.test` for clinic assistance.

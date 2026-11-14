---
id: '05'
tenant: acme
title: Confirmation emails
audience: patient
---

# Your Acme Physio confirmation

Booking confirmations are sent from `noreply@acmephysio.test`.
They describe the physiotherapist, appointment date and local time. Acme includes
contact details when available; providing a phone number is optional. After a
move, check **My bookings** for the new time.

In this fictional demonstration, email is delivered to the local Mailpit inbox,
not to a real email service. **My bookings** at `/bookings` is the place to check
your current appointment status if an email is missing. Ask Alice Archer at
`alice@acmephysio.test` for clinic assistance.

## A reminder before your session

Reminders start switched on. When Acme Physio's reminder setting is on, BookIt
makes one email attempt between **23 and 24 hours** before your booked time.
This means elapsed hours, including when UK clocks change. A time booked or
moved with less than 23 hours to go does not get a reminder. Turning reminders
back on only covers times still in that window. Cancelled bookings get no reminder.

The email shows Acme Physio, your physiotherapist, the duration and the day, date
and 24-hour UK time. It includes **Reschedule** and **Cancel** links and never
includes a phone number, even if contact details are included in confirmations.

Open a link and sign in with your clinic account. You return to the linked
booking. Each link shows only your own current booking, including any move made
since the email. For a move, choose a new time and review both times and the move
limit before **Confirm reschedule**. For a cancellation, review the current time
and the late-cancellation warning before **Confirm cancellation**. Use **Back to
my bookings** to leave without changing anything. Your old time stays booked if
a move fails. A successful move makes the new booked time eligible for one reminder.

While a change is saving, the confirmation button shows **Saving your booking…**
and cannot be pressed again. Wait for **My bookings** to show the result.

BookIt does not retry a failed or interrupted reminder attempt, because the mail
service may already have accepted it. A missing email does not change your booking.
Check **My bookings** for the current details.

## Staff: switch reminders on or off

Sign in as Acme Physio staff, open **Clinic bookings**, then **Clinic settings**.
Change **Send reminder emails** and select **Save settings**. The saved choice
stays in place after you reopen the page. It affects only Acme Physio; clients
cannot change it. Switching reminders off stops future reminder attempts. An
email already sent cannot be recalled.

If a setting needs correcting, the page keeps your entries, including the reminder
choice, and marks the field to change. Correct it and select **Save settings**
again. Nothing is saved until you see **Clinic settings saved.** If saving fails,
your entries stay on the page so you can try again.

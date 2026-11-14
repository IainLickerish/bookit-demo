---
id: '05'
tenant: beacon
title: Confirmation emails
audience: patient
---

# Your Beacon Dental confirmation

Look for booking and rescheduling confirmations from `noreply@beacondental.test`.
They include your clinician and appointment date and time. Beacon does not include
patient contact details in confirmation messages.

This is a fictional demonstration: messages go to the local Mailpit inbox rather
than a real mail service. If a message is missing, check **My bookings** at
`/bookings` for the current appointment. For help, ask Bella Byrne at
`bella@beacondental.test`.

## A reminder before your appointment

Reminders start switched on. When Beacon Dental's reminder setting is on, BookIt
makes one email attempt between **23 and 24 hours** before your booked time.
This means elapsed hours, including when UK clocks change. A time booked or
moved with less than 23 hours to go does not get a reminder. Turning reminders
back on only covers times still in that window. Cancelled bookings get no reminder.

The email shows Beacon Dental, your clinician, the duration and the day, date
and 24-hour UK time. It includes **Reschedule** and **Cancel** links and never
includes a phone number, even if contact details are included in confirmations.

Open a link and sign in with your clinic account. You return to the linked
booking. Each link shows only your own current booking, including any move made
since the email. For a move, choose a new time and review both times and the move
limit before **Confirm reschedule**. For a cancellation, review the current time
and the late-cancellation warning before **Confirm cancellation**. Use **Back to
my bookings** to leave without changing anything. Your old time stays booked if
a move fails. A successful move makes the new booked time eligible for one reminder.

BookIt does not retry a failed or interrupted reminder attempt, because the mail
service may already have accepted it. A missing email does not change your booking.
Check **My bookings** for the current details.

## Staff: switch reminders on or off

Sign in as Beacon Dental staff, open **Clinic bookings**, then **Clinic settings**.
Change **Send reminder emails** and select **Save settings**. The saved choice
stays in place after you reopen the page. It affects only Beacon Dental; clients
cannot change it. Switching reminders off stops future reminder attempts. An
email already sent cannot be recalled.

# Appointment reminders

Reminders are on by default. Clinic staff can change **Send appointment reminder emails** in **Clinic settings** and save. Switching them off leaves confirmation emails working as before.

While the server is running, it checks every minute for confirmed appointments starting within the next 24 hours. If it was stopped at the usual reminder time, it sends the reminder on its next check, provided the appointment has not started. A booking made less than 24 hours ahead is also included. Switching reminders back on includes appointments still in this window.

The email contains the appointment date, UK time, practitioner and links to reschedule or find the cancellation button in My bookings. Clients must sign in and the existing booking rules still apply. The links never change a booking just by being opened.

Cancelled and past bookings are excluded. A move before the reminder is sent uses the new appointment time. Once a reminder has been attempted, moving the booking does not produce another reminder.

Each booking has at most one delivery attempt, recorded before contacting the email server. Failed or interrupted attempts are not retried, as the email server may already have accepted the message. This prevents duplicate reminders but a delivery failure or server interruption can mean a reminder is missed. Staff can see `email.reminder.sent`, `email.reminder.failed` and `reminder.worker_failed` events in the server logs. No recipient address or email body is logged.

The existing email setup applies: configure `BOOKIT_SMTP_URL`, `BOOKIT_MAIL_FROM` and `BOOKIT_PUBLIC_URL` for the clinic. Without SMTP, reminders are left pending. As elsewhere in this demo product, sender and recipient addresses must use `.test` domains.

Email connections, greetings and inactive connections time out after three seconds. A stalled email server therefore releases the booking and clinic settings locks promptly, so clients can change bookings and staff can save settings. A timed out reminder keeps its recorded delivery attempt and is not retried.

Migration 0002 adds a reminder switch to clinic settings, initially on, and a nullable delivery attempt time to each booking. Existing bookings are eligible when they enter the reminder window. To undo the feature, switch reminders off first and stop the updated server. Roll back the application, then drop `booking.reminder_attempted_at` and `clinic_settings.reminders_enabled`. Dropping these columns loses the reminder history, so re-enabling the feature after that could send another reminder for a booking that has already had one.

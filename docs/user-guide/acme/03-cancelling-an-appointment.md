---
id: '03'
tenant: acme
title: Cancelling an appointment
audience: patient
---

# Cancelling an Acme Physio session

Open **My bookings** at `/bookings`, find the session and select **Cancel**.
Check that it moves to the past and cancelled list. A cancelled time becomes
available for another patient.

Acme Physio treats cancellations made less than **24 hours** before the start as
late cancellations. At exactly 24 hours the cancellation is not late. A session
that has already started cannot be cancelled in BookIt; contact the clinic.

A late cancellation appears as **Cancelled (late)** in your past and cancelled
list and in the clinic's bookings. It releases the time just like an ordinary
cancellation. The clinic's current settings determine the late-cancellation window.

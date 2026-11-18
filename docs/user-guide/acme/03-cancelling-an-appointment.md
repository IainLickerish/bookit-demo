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
late cancellations. These sessions show as **Cancelled (late)** in My bookings.
At exactly 24 hours the cancellation is not late. A session that has already
started cannot be cancelled in BookIt; contact the clinic.

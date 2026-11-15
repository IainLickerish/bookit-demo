---
id: '06'
tenant: acme
title: Viewing bookings
audience: admin
---

# Reviewing Acme Physio bookings

Sign in with the Acme clinic admin account and open **Clinic bookings** at `/admin`.
Filter by **physiotherapist**, date or booking status, then apply the filters.
Dates refer to the clinic's Europe/London calendar day. Clear a filter to widen
the view; an empty list means no appointments match the current selection.

The table includes patient names and booking status. Only authorised Acme clinic
staff should use this page. Patients see their own appointments through **My bookings**.

## Blocking time away

From **Clinic bookings**, choose **Block time**. Select the physiotherapist, enter a
start and end in the clinic's time zone, and add a **Reason (optional)** if useful.
Choose **Save blocked period**. Correct any field errors and try again; your entries
stay in the form. Times skipped when the clocks go forward cannot be entered.
When the clocks go back, a repeated time uses its first occurrence.

The saved period appears below the form. Clients cannot see blocked periods,
reasons or warnings. Any slot that overlaps the period becomes unavailable for
booking and moving, including from a screen opened earlier. A slot ending at the
start, or starting at the end, remains available. Other practitioners are unaffected.

A warning lists every confirmed booking that overlaps the period, or says that
none overlap. Existing bookings stay confirmed. Contact the affected clients to
arrange another time. Return to this page to review saved periods and warnings.

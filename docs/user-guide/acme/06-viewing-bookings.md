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

From **Clinic bookings**, open **Blocked time**. Choose a physiotherapist, a
future start and end in the clinic's time zone, and an optional reason of up to
300 characters. Keep the reason brief, without personal or medical details.
Times repeated or skipped when the clocks change cannot be used; choose another
time. The end must be after the start.

Choose **Review blocked time**. Check the physiotherapist, the start and end,
and every affected session, including its client, time and duration. Any
confirmed session overlapping the block, even partly, will be cancelled.
A session ending exactly at the block's start or starting exactly at its end
is unaffected. **Change details** returns to your entries without saving.

Confirm once to save the blocked time and all affected cancellations together.
If the affected bookings change before you confirm, nothing is saved. Review
again to see the current impact. Clients cannot book or move into blocked time,
and cancelled sessions appear in their **My bookings** list. These staff
cancellations are not marked as late client cancellations.

No cancellation emails are sent at this stage. Arrange contact with affected
clients using your clinic's existing process.

Open a block under **Saved blocks** to revisit its time, reason and cancelled
bookings. A block with no affected bookings says so. Only your clinic's staff can
create or view these blocks. This page does not offer editing or removal of saved
blocks.

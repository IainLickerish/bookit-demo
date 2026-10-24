---
id: '07'
tenant: acme
title: Exporting bookings to CSV
audience: admin
---

# Exporting Acme Physio bookings

Open the clinic bookings page at `/admin`, select the required filters and choose
**Export CSV**. The downloaded file contains the same filtered bookings. Open it
in a spreadsheet using UTF-8 so accented patient names display correctly.

Commas, quotation marks and line breaks in fields are quoted in the CSV. Values
that could be interpreted as spreadsheet formulas are treated as text. Store
exports only where authorised Acme staff can access them. Signing in as a patient
does not grant permission to export the clinic's bookings.

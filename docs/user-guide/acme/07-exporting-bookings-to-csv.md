---
id: '07'
tenant: acme
title: Exporting bookings to CSV
audience: admin
---

# Exporting Acme Physio bookings

Open **Clinic bookings**, select the filters you need and choose **Filter bookings**.
Choose **Export filtered bookings (CSV)** to download the bookings in the list.
Open the file in a spreadsheet using UTF-8 to see client names as they appear in the list,
including accents and other non-English letters.

Commas, quotation marks and line breaks in fields are quoted in the CSV. Values
that could be interpreted as spreadsheet formulas are treated as text. Store
exports only where authorised Acme staff can access them. Signing in as a patient
does not grant permission to export the clinic's bookings.

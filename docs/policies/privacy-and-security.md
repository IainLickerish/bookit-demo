# Privacy and security policy

Owner: Iain Lickerish · Last reviewed: 2026-11-11 · Applies to: BookIt

In one line: How people's data is protected.

## Personal data kept

BookIt uses made-up people and `.test` email addresses. For sign-in and bookings it keeps names, email addresses,
optional phone numbers, account roles and protected password records. Bookings link clients to practitioners and
times, with contact phones, status, cancellation details, move counts and record dates. Practitioner names,
biographies and working hours help clients choose. There are no medical notes or payment records.

Accounts, practitioner records and bookings, including cancellations, have no automatic deletion date. Restarts
and repeat setup preserve them. Sign-in lasts 12 hours; reset links last 30 minutes and work once. Expiry does not
delete stored records. Signing out deletes that sign-in record; resetting a password deletes all that account's
sign-in records. Reset records remain. Reset request limits use obscured email and internet address references
in memory, cleared on restart with no fixed deletion schedule. AWS CloudWatch logs default to 30 days,
configurable by the owner. Local logs and exports have no automatic deletion schedule. No backup or recovery
schedule is defined here.

- **PS-1** Keep only the made-up account, practitioner and booking details described above, with phone numbers optional. [review]

## Who may see what

Signed-out visitors cannot see bookings. Clients see available times and their own bookings, and book, move or
cancel their own bookings within clinic rules. They cannot see or change another client's bookings, export
clinic bookings or change settings. Clinic admins view and filter their clinic's bookings and download names,
booking references, practitioners, times, status, late-cancellation markers and phones. They can change the clinic
name, time zone, late-cancellation period and whether confirmations include phones. Staff pages offer neither
account management nor booking changes on clients' behalf. Clinics have separate accounts and records; access
checks happen before information is returned or changed. Exports belong only where authorised clinic staff can
access them.

- **PS-2** Allow clients access only to their own bookings and reserve clinic reports, exports and settings for that clinic's authorised staff. [you judge]

## Outside services

AWS hosts the demonstration in London on encrypted disks. CloudWatch receives service logs with activity, account
and booking references, obscured email references and clinic details. SupportAgents reads only its clinic's logs.
Mailpit holds emails inside the clinic's setup: recipient address, name, clinic, practitioner, booking reference
and time, plus a phone when enabled; reset emails contain names and reset links. Sending refuses addresses outside
`.test`. No real email provider is approved.

Optional Sentry receives error details, page addresses, request references and clinic and release details. It
removes user details, form contents, cookies, other request headers, query details and reset links from page
addresses. Disabled reporting sends nothing; tests use local receivers. Mailpit and Sentry retention periods are
not set here. No AI service is approved to receive real personal data. These services may receive made-up data
only.

- **PS-3** Send data only to the services named here, for the purposes and within the limits stated here. [you judge]

## Secrets and access

Account, sign-in and reset records hold protected versions of passwords and secret links. Password resets end
existing sign-ins and replace earlier reset links. Admin sign-in has no second identity check. Original generated
account and database passwords stay in private files supplied only where needed. Sign out of shared devices.
The owner controls hosting access through AWS Systems Manager; production releases require a person's approval.
Setup details are in [the hosting guide](../../infra/aws/README.md) and
[the release guide](../ci-and-deploy.md).

- **PS-4** Keep passwords, keys and secret links private, outside code, logs, tickets and pull requests. [you judge]

## If something goes wrong

Errors are recorded and, when enabled, reported to Sentry. A failed confirmation email leaves the booking in
My bookings. No automatic incident notification, response deadline or breach procedure is defined. Recommended
owner procedure: on discovery, tell Iain Lickerish and the affected clinic immediately; the owner stops further
exposure, removes compromised access, records what happened and arranges any required further notices.

- **PS-5** Tell the owner and affected clinic immediately when a possible loss, leak or misuse of data or access is discovered. [you judge]

## Examples

Do: use a made-up client to investigate a missing confirmation and share only the booking reference with authorised support. Don't: paste a client's details or a reset link into a ticket or an AI service.

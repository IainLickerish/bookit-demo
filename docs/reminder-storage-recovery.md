# Reminder storage, sending and recovery

Step 1 adds the clinic preference and durable history. Step 2 runs unattended
checks in the long-lived Node application and sends reminders through the existing
demo mail service. Direct reminder action destinations remain for step 3.

## Decided

- Existing bookings, cancellations, moves and settings remain intact (PR-14, EN-6).
- Reminders start off for existing and newly created clinics. Staff explicitly
  choose whether to enable them. Each clinic keeps its own preference (PR-15).
- History records a booking reference, the reserved slot and its start time,
  reservation time and optional confirmed sending time. It copies no names,
  addresses, phone numbers, email content or private links (PS-6, PS-7).
- A booking has at most one reservation, enforced in storage. An unconfirmed
  sending time must not be interpreted as permission to resend. Delivery uncertainty is
  handled by retaining this reservation and never automatically retrying it.
- Moving or cancelling a booking does not erase its history. Bookings without
  history remain without history during upgrade. This step never invents a send.
- The clinic settings screen and save action both check the current signed-in
  staff role using the clinic's own database. No request selects a clinic (PR-15).
- Tenant files and seed fingerprints stay unchanged, so existing clinic identity
  checks still work on restart. Reseeding does not reset the preference (EN-6).
- Existing user guides and components take precedence only where the supplied
  policies do not specify otherwise. New wording follows DS-7 and DS-8. Existing
  unrelated styling and booking journeys are outside this step (PR-1, EN-4).

## Apply

Use the dedicated fictional clinic databases and mounted credentials described in
README.md. Run `bun run db:migrate` separately for each clinic before starting the
new application. Migration `0002_panoramic_zarek.sql` only adds a table and a boolean
column with a false default. It neither updates nor deletes booking rows.

## Recover by returning to the previous application

1. Stop the new application for the affected clinic. The reminder loop runs
   inside each Node application process, so stop every new application instance.
2. Start the previous application version against the same clinic database and
   existing mounted credentials. **Keep the new table, column and migration
   journal. Do not run DROP statements or remove a migration entry.** The added
   column has a default, so previous inserts still work. Previous settings writes
   leave it alone.
3. Sign in as that clinic's staff, check its bookings and save a normal setting.
   Previous code will not show the reminder switch; its saved choice and history
   remain in storage. The previous
   application has no reminder loop. Keep unconfirmed reservations intact.
4. When returning to the new version, run `bun run db:migrate` again and restart it.
   Check bookings and the saved reminder choice. Migration reruns leave data intact.

There is no destructive schema rollback. Keeping the additions preserves all
activity since upgrade and avoids restoring an older database over newer bookings.
Restrict any operational database access and any private copies to authorised
operators. Never put a database copy or its credentials in source or test evidence
(PS-6, PS-7).

## Recovery checks

`tests/integration/reminder-storage.int.test.ts` applies the released migrations,
creates fictional confirmed, cancelled and moved bookings, upgrades using the
normal migrator, and compares saved records. It checks empty installation,
concurrent duplicate reservation refusal, references, sending-time validation and
history retention after moving and cancelling. It rehearses previous-version
booking reads, new bookings and settings writes against the upgraded schema, then reapplies
migrations and checks bookings, history and preference survive.

`tests/unit/reminder-settings.test.ts` checks that both tenant fingerprint inputs
remain byte-for-byte equivalent after parsing. The settings integration test uses
separate disposable clinic databases and real sessions to check foreign, patient,
expired, forged and removed-staff access, through the page and save action.

## Sending decisions for step 2

- Each running Node application starts one serial loop after startup checks. It
  checks immediately and then every 10 seconds after the previous pass finishes.
  Multiple instances are safe because the database allows only one reservation
  per booking. No browser request, public trigger, extra credential or external
  scheduler is needed. Run the existing `bun run start` or Compose service. This
  design assumes the repository's long-lived Node deployment, not serverless
  functions (EN-1, EN-4).
- A confirmed booking is due when it is still upcoming and at most 24 elapsed
  hours away. Checks catch up after downtime and handle bookings made inside the
  window. They never send for started bookings. A check processes successive pages of up to 50 candidates
  in time and booking-reference order, advancing past refused or skipped rows (PR-7, PR-14).
- The ticket explicitly requires UK time, so reminder emails always use
  Europe/London, including clock changes, even if staff change the clinic's
  display time zone. This follows the owner's words for this change over PR-7's
  general clinic-zone rule. Existing screens and confirmation emails are unchanged.
- A durable reservation commits before SMTP is contacted. A second transaction
  locks the setting and booking, rereads current details and sends while those
  locks are held. Moves, cancellations and switching reminders off are therefore
  ordered before or after sending. If the current booking or setting changed
  before SMTP, only this invocation's known unused reservation is released. The
  next pass can follow the moved booking's new time (PR-14, PR-15).
- After contacting SMTP, a failed or missing acknowledgement, failed outcome
  write or process loss leaves an unconfirmed reservation. It is never retried
  automatically. This can mean a missing email, but avoids two reminders when
  the first may already have arrived. Moving a booking never restores its
  reminder allowance after an attempted or uncertain send. My bookings remains
  the place to check details (PR-9, EN-6).
- SMTP connections, greetings and idle sockets have 10-second timeouts. Disabled
  mail transport makes no reservation. Only fictional .test senders and recipients
  are accepted, through the existing Mailpit service. Emails contain no phone
  numbers or private tokens. Logs contain event names, booking references and
  hashed recipients, never email bodies or raw SMTP errors (PR-21, PS-6, PS-7).
- Emails put the clinic first and use its own session or appointment and
  practitioner wording. Their only management link is the existing signed-in
  My bookings page using BOOKIT_PUBLIC_URL. Explicit reminder action destinations
  and booking confirmation changes remain outside step 2 (DS-1, DS-7, DS-8, PR-1).

`tests/integration/reminder-sending.int.test.ts` covers timing, moves, cancellation,
switch-off, repeated and overlapping passes, fresh database connections, process
loss, uncertain mail acceptance, outcome-write failures, race rechecks, lock
ordering, clinic isolation and local SMTP. Unit checks cover UK clock changes and
serial unattended scheduling. The owner checks in `evals/11-reminder-emails.eval.ts`
wait for mail from the real loop without triggering it themselves.

## Timing eval fixture

The strengthened timing check books outside the window with reminders already on.
It waits for a completed background check before asserting no reminder, advances
to the 24-hour boundary, and makes no application requests until mail arrives.
Background check sequence counters prove that the mail came from the first check
at the new time. The check retains its email-detail and no-repeat assertions.

`/api/debug/reminder-clock` exists only in an explicitly test-clock build running
locally with a configured clock file. Normal builds and staging or production
runs return 404. Both reading and changing it require signed-in clinic staff;
changes also require the configured same-origin request. It never starts a
reminder check. Advances are accepted only between checks, and the fixture is
reset after the eval. The original file is never rewritten: its readability and
monotonicity checks stay active while an ephemeral in-memory fixture is in use.
The fixture exists solely to verify this reminder journey under EN-5, not as a
clinic control or production scheduler.

The pagination regression creates 160 due bookings with equal start times: 50
refused addresses, 50 accounts that are no longer patients and 60 eligible clients.
One check must reach all 60 eligible bookings and repeated checks must send none
again. Queries remain bounded to 50 rows and skipped candidates cannot starve
later bookings.

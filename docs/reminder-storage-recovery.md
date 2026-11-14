# Reminder storage and recovery, step 1

This step stores a clinic preference and reminder history. It does not send
reminders, run unattended checks or add reminder action links.

## Decided

- Existing bookings, cancellations, moves and settings remain intact (PR-14, EN-6).
- Reminders start off for existing and newly created clinics. Staff explicitly
  choose whether to enable them. Each clinic keeps its own preference (PR-15).
- History records a booking reference, the reserved slot and its start time,
  reservation time and optional confirmed sending time. It copies no names,
  addresses, phone numbers, email content or private links (PS-6, PS-7).
- A booking has at most one reservation, enforced in storage. An unconfirmed
  sending time must not be interpreted as permission to resend. Delivery rules
  and handling uncertain delivery belong to step 2.
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

1. Stop the new application for the affected clinic. No reminder worker exists in
   this step, so there is no extra process to stop.
2. Start the previous application version against the same clinic database and
   existing mounted credentials. **Keep the new table, column and migration
   journal. Do not run DROP statements or remove a migration entry.** The added
   column has a default, so previous inserts still work. Previous settings writes
   leave it alone.
3. Sign in as that clinic's staff, check its bookings and save a normal setting.
   Previous code will not show the reminder switch; its saved choice and history
   remain in storage. No reminder email is sent by either version in this step.
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

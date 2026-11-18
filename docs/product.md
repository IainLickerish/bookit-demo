# BookIt: the product

BookIt helps clinic clients arrange their appointments and clinic staff keep an accurate diary. It puts privacy and
bookings that are saved correctly before speed, polish or new features. Each rule has a short ID (PR-1 and so on) so a
review can name it.

## What it is

A booking service for a made-up clinic, Acme Physio, used only to test the Software Factory. It works when clients
can manage routine sessions themselves and staff can rely on the clinic's diary, so reception has less to do.

- **PR-1** Keep changes about arranging appointments and keeping the clinic's diary accurate.

## Who it is for

- **Clients** (patients): often on a phone, away from the clinic, sometimes unwell, anxious or in a hurry, and not
  always confident with technology.
- **Clinic staff**: at a computer at reception, finding bookings, exporting a selection and keeping the clinic's
  settings right.

## What people do

- Clients sign in, choose a practitioner, a day and a free time, check it and book, then find it in My bookings. They
  can move or cancel an upcoming booking, which frees the old time. Forgotten passwords are reset from the sign-in
  page.
- Staff filter the clinic's bookings by practitioner, date and status, export that selection, and change the clinic's
  name, time zone, cancellation window and the contact details in emails.

- **PR-2** Let signed-in clients manage routine appointments without needing reception's help.
- **PR-3** Give staff exports that match the list they filtered, keeping names exactly as written, accents included.

## What comes first

- **PR-4** Privacy and correctly saved bookings first; then that people can finish what they came to do, on any device
  and with any ability; then fewer steps, staff convenience, polish, and new features last.
- **PR-5** A known fault, such as a misleading cancellation message, is something to fix, never behaviour to keep.

## What it will never do

- **PR-6** Never give the same practitioner's time to two clients, even when bookings or moves happen at the same
  moment.
- **PR-7** Never lose a client's booking when a move fails: the old time is released only once the new one is secured.
- **PR-8** Never say something worked unless it was saved: the message, the booking's status and the lists must agree.
- **PR-9** Never require a phone number to book.
- **PR-10** Never make clinical decisions, diagnose or recommend treatment.

Who may see what, and keeping secrets and real people's data out, are engineering rules: EN-4 and EN-5 in `AGENTS.md`.

## Out of scope

- **PR-11** Medical records, payments and marketing campaigns are out of scope for now; BookIt stays a demonstration
  with made-up clinics, people and email addresses. Anything broader is the owner's decision, not a routine change.

## Example

Do: keep a client's original appointment when the new time they chose has just been taken. Don't: show "Booking
cancelled" while the appointment is still confirmed.

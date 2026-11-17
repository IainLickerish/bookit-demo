# Privacy practices: for the owner

How BookIt's data should be looked after while it runs. These are practices for the people running BookIt, not rules
a code change can meet, so no AI agent is given this file and none of it sends a change back. The rules that apply to
changes are EN-4 and EN-5 in `AGENTS.md` and PR-11 in `docs/product.md`.

## What is kept

Accounts hold names, email addresses, roles, optional phone numbers and protected password records. Bookings hold the
client and practitioner, times, status, optional phone numbers, cancellations and how often they were moved. Security
records and logs support sign-in and finding faults. Accounts and bookings stay until removed by hand; sessions expire
after 12 hours and reset links after 30 minutes, but expiry does not delete their records. AWS logs are kept 30 days by
default; local logs have no set expiry. There is no complete deletion or backup schedule.

## Recommended practices

1. **Deleting demo data.** Delete a demo's records and copies within 30 days of the demo ending, including expired
   security records, local logs, captured mail, exports and any backups.
2. **Downloaded booking files** stay in places the clinic approves, open only to its authorised staff.
3. **Outside services.** Before adding or changing any outside service that receives account or booking data, agree
   its purpose, the data, where it is processed, who can see it and when it is deleted.
4. **People's requests.** Check who is asking, then answer a request to see, correct, download or delete their data
   within one calendar month, recording any justified delay or anything kept.
5. **Access.** Give administrative accounts and keys only to named, approved people who need them, and remove access
   as soon as that need ends.
6. **If something goes wrong.** Contain a suspected exposure and tell the owner and the clinic's lead within one hour.
   A nominated privacy lead assesses it within 24 hours, arranges any notices to people and regulators without delay,
   and records when it was found, what data, what was done, what was notified and the outcome.

## Outside services today

The supplied AWS setup keeps databases on encrypted disks in London and sends container logs to CloudWatch there.
SupportAgents can read its clinic's logs. Mailpit runs beside BookIt and captures the emails it sends, including
private reset links. Optional Sentry receives stripped-down errors; nothing is sent when it is not set up. GitHub
holds the code, images and test evidence, which is kept 14 days. Where GitHub, hosted Sentry and SupportAgents process
data is not established here.

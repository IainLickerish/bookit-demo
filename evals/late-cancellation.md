# Late-cancellation checks

`10-late-cancellation.eval.ts` adds two journeys on the supplied running Acme
copy, using `EVAL_BASE_URL`, the fictional demo accounts and the fixed `EVAL_NOW`.
It never starts an app, database or Docker, changes the clock, or contacts
another clinic. Each journey books its own named time later on the demo day.

The first checks the saved client status after reloading and the staff Cancelled
and Confirmed filters. The second checks that two other clients can choose a
released time but only one can book it. Both fail if late cancellation reports
success without saving the cancellation. Files 01 to 09 remain unchanged and
run alongside these journeys.

Product integration tests cover both clinics, configured cancellation boundaries,
failed saves, repeated cancellation and simultaneous booking. The unit suite also
loads every owner check to catch broken imports, focused tests or skipped tests.

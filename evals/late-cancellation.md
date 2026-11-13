# Late-cancellation checks

`10-late-cancellation.eval.ts` checks the eight agreed behaviours for late
cancellation. Each test has its own clinic copies, using the existing Docker
fixtures in `tests/helpers/compose.ts`, the supplied fictional `EVAL_PASSWORD`
and the fixed `EVAL_NOW` date. Docker and Compose are required. The current
source is built once for these checks. The regular demo copy is left alone.

Clients book and cancel through the browser. These copies allow the checks to
advance time to the exact cancellation boundary or the appointment start.
Signing in again after a long clock advance keeps session expiry separate from
the cancellation being checked. Older tabs still submit their original forms,
so refusals are checked on the server as well as on the page.

The failed-save check temporarily makes PostgreSQL refuse cancellation updates.
It checks the real error page, then removes the failure and checks the unchanged
booking through the client and staff screens. No browser response is replaced.
Saved records are also compared before and after viewing existing bookings.

The final check runs files 01 to 09 unchanged against a fresh Acme copy. Their
reports and screenshots accompany its results. It then checks a late
cancellation in that same copy. Only those existing filenames are passed to the
child runs, so the final check cannot run itself.

`bun run test:unit` also loads every owner check with Playwright's list command.
This catches syntax and import errors, focused tests and skipped checks before
the factory runs the journeys. Discovery needs no Docker or running demo.

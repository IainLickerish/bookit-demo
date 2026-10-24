# M0-24d: tenant data, guides and local containers

Bead: `supportagents-m0-24d-xa4`. Requirements: REQ-18.1-03, REQ-18.1-06,
REQ-18.2-01. Base: BookIt PR #3, `845d432`. This change is stacked on that
branch and does not wait for its owner merge. No product default-branch push,
merge, image publication or deployment is part of this work.

## Delivered behaviour

`tenants/acme.json` and `tenants/beacon.json` contain distinct clinic rules,
branding, contacts, domains, test accounts and practitioners. The seed uses an
injected clock, creates the three Acme Unicode names, keeps patient 2's phone
absent, creates a booking three hours ahead and reference slots across the next
London clock change. Beacon's practitioner has `BEACON-SEED-MARKER`.

Seeding is transactional and serialised. A seed-only singleton table binds a
database to tenant, environment and configuration fingerprint. Reruns preserve
bookings, settings and password hashes. A foreign identity, changed configuration
or nonempty unbound database is refused. Container startup checks the same binding.
Account passwords come from the caller; logs contain only counts and identity.

The image carries all five build arguments from the operations contract:
`GIT_COMMIT`, `BUILD_ID`, `BOOKIT_IMAGE`, `BUILT_AT` and `BOOKIT_ALLOW_TEST_CLOCK`.
It uses the existing runtime identity, logging, SMTP, Sentry and clock variables.
The web process runs as an unprivileged user. Compose runs one clinic per project
with a separate database, non-superuser app role and internal network. A proxy
with two fixed destinations exposes BookIt and Mailpit on host loopback; it is
not a general forward proxy. This supports rootless Docker without adding an
Internet route to the application or database containers.

The local credential helper creates read-only files inside a private `0700`
directory. Rootless Compose can mount each file for its intended container UID,
while other host users cannot traverse the directory. Existing credentials are
never overwritten or printed. The account-password file is mounted only into
the seed container, and the bootstrap and application database passwords differ.

## Article list

| Article             | Acme                                                                            | Beacon                                                                              |
| ------------------- | ------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| 01 Getting started  | [Physiotherapy](../user-guide/acme/01-getting-started.md)                       | [Dentistry](../user-guide/beacon/01-getting-started.md)                             |
| 02 Booking          | [45 minutes](../user-guide/acme/02-booking-an-appointment.md)                   | [30 minutes](../user-guide/beacon/02-booking-an-appointment.md)                     |
| 03 Cancelling       | [24-hour window](../user-guide/acme/03-cancelling-an-appointment.md)            | [48-hour window](../user-guide/beacon/03-cancelling-an-appointment.md)              |
| 04 Rescheduling     | [Three moves](../user-guide/acme/04-rescheduling-an-appointment.md)             | [Two moves](../user-guide/beacon/04-rescheduling-an-appointment.md)                 |
| 05 Confirmations    | [Acme sender and contact details](../user-guide/acme/05-confirmation-emails.md) | [Beacon sender, no contact details](../user-guide/beacon/05-confirmation-emails.md) |
| 06 Admin bookings   | [Physiotherapist filter](../user-guide/acme/06-viewing-bookings.md)             | [Clinician filter](../user-guide/beacon/06-viewing-bookings.md)                     |
| 07 CSV export       | [Acme guide](../user-guide/acme/07-exporting-bookings-to-csv.md)                | [Beacon guide](../user-guide/beacon/07-exporting-bookings-to-csv.md)                |
| 08 Account/password | [Acme account](../user-guide/acme/08-account-and-password.md)                   | [Beacon account](../user-guide/beacon/08-account-and-password.md)                   |

Both Article 08 files retain `/account/reset-password`, following the owner's
explicit instruction and plan 12.3. This supersedes the conflicting bead sentence.
The real password-reset route belongs to `supportagents-8uvs`. No expected-fix
patch or deliberate-defect reproduction suite is added to BookIt.

## Validation and evidence boundary

Validation uses Node 24.22.1, Bun 1.4.4, PostgreSQL 17 containers, Vitest 5.0.5 and
Playwright 1.64.1. The full Vitest suite passed 164/164 across 20 files, including
existing concurrency, notifications, SDK-receiver and startup-refusal regressions.
The focused tenant/seed selection passed 23/23 (17 unit and six integration).
The full Playwright suite passed 18/18, including all 14 earlier journeys and
the four container journeys. Type checking, lint, formatting and `git diff --check`
passed. The last test-only refinement retains independent SDK receipt metadata
in guaranteed teardown; the focused container suite verifies that evidence path.
That final focused run passed 4/4, with zero matches across 14 password/patient
canaries per clinic. Its test-clock image was reused from the passing full run;
the final changes affect evidence capture only. The production image was rebuilt.

The container journeys verify both clinics' health/version endpoints, local SDK
receipt with product/environment/release, virtual time and counter request IDs,
tenant-only admin pages/exports, foreign-session refusal, patient login and the
three-hour booking, unchanged reseeding, database and direct network denial,
foreign container identity refusal, missing-commit build rejection and production
image refusal of the virtual clock. The fixture uses a synthetic full commit SHA
to prove identity wiring; it does not claim release attestation.

Browser tests reuse the `.next-e2e` build produced by the full startup suite;
application code is unchanged. Compose's test-clock and production images are
built separately. Its SDK receiver never forwards an event, and clinic networks
have no Internet route. No live model, real email service or hosted Sentry is used.
Browser traces are disabled for these generated-credential journeys.

Guaranteed teardown retains source/config/fixture hashes, expected/observed test
outcomes, container health, independent SDK receipt metadata and canary-checked
logs under `test-results/m0-24d/`. A canary match withholds logs and fails the check.
Containers are stopped after testing; volumes and private fixture files are kept.
SupportAgents case/Change/action/policy/model/provider/data-access and audit-chain
records do not exist in this BookIt-only feature. Full SupportAgents staging versus
production network proofs and the assembled fake-Sentry service remain M0-26 work.

## UBS review

The literal `ubs .` attempt timed out in JavaScript and is explicitly a partial
scan, not a pass. A scan excluding dependencies and generated/test output completed
over 124 authored files with ten critical labels and 47 warnings. Seven critical
labels are the previously reviewed baseline findings from M0-24b.

The final changed-file union scan covers 14 files (including both shell scripts):
three critical labels and 13 warnings, exit 1. The three critical labels are false
positives: a rejected synthetic `password: 'unexpected-field'` in a schema test,
and `Buffer.concat`/bounded `gunzipSync` in the local SDK receiver, neither of which
merges object properties. No scanner rule is disabled or finding suppressed.

The remaining warnings concern intentionally fatal checked-in JSON parsing and
test-fixture parsing, a synchronous secret-file read inside a disposable test
process, and assertions on SQL aggregate/test-fixture rows. The PostgreSQL
aggregates always return a row. Missing-row cases in the seed identity and slot
selection have explicit guards. Fetch timeout warnings found during review were
fixed. Both shell scripts pass the Bash/ShellCheck module without findings.

## Retained artifact index

The committed [Compose health and SDK receipt summary](M0-24d-compose-health.json)
contains the observed service states for both clinics, test outcomes, receipt
metadata and redaction results. The two Acme one-off BookIt containers with exit
1 are the expected foreign-identity and production-clock refusal fixtures; the
normal BookIt, database, mail and web services were healthy. Containers were
stopped after evidence capture.

Raw bundles are under ignored `test-results/m0-24d/`. The checksums below and the
committed summary preserve durable references beyond that local directory.

| Artifact                                                              | SHA-256                                                            |
| --------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `full-vitest-164.json`                                                | `63b704875c19eb6809e8444153abf0f8d0babbcf72f5f49012dbfea947b603c0` |
| `full-playwright-18.json`                                             | `a728443146bc5e215b25d26a730a1443bdccc5a1de54f227391ee36391eb103c` |
| `final-compose-evidence-4.json`                                       | `34f016bc563287914ee1644f9dba5527423da65f278ac8dfb3f603ac44e33282` |
| `compose-acme-b7778b80-5173-40ea-b6f1-ae815963c193/evidence.json`     | `cfb5970349931a99b2733a5d97e4622270b34df87de003812883960d8bac1d32` |
| `compose-beacon-5c882b6b-99b5-40d9-89cd-1cd3720813d1/evidence.json`   | `8f5a8a19b428e6d94f3cc3d8936d160b978b42094c783eb186332279d0a55292` |
| `production-build-b675ca7d-5009-4c06-90fc-dc959b589ca7/evidence.json` | `5007138f6e719db71441ffee7ad098295dbfd1c043cf789e8f73a0ca99bbf16b` |

Scanner logs are directly under `test-results/`: `m0-24d-ubs-final.log` SHA-256
`b277c2890829140d686254519ea7380906880ca7381ee87d5fc7d0cce5e838a8`;
`m0-24d-ubs-authored.log` SHA-256
`e0de0ac82c2cd4335ecaa194e2e11ab5f48acad7c5b7cc8e62b3cd5218c30990`;
`m0-24d-ubs-full.log` SHA-256
`1c4e0cdaf0c1a179e4ae39466ac9dd1aebd59ef3747e7a226742f134afb61482`.

## Password-reset runtime contract follow-up

Agent Mail #79 added `BOOKIT_PUBLIC_URL` for password-reset PR #4, which remains
separate from this PR's base. Compose now requires and forwards the tenant's public
origin; the README supplies distinct Acme/Beacon examples and documents passing
the variable to a direct container run. The image does not bake in a shared origin.
Both Article 08 files retain the owner's old-path baseline.

The focused container suite passed 4/4 again, now also reading the public-origin
variable from each running BookIt container and checking it against that clinic's
published URL. This verifies the Compose handoff; PR #4 owns the reset-route logic.
The test-clock image reused unchanged application code; the production image was
rebuilt. Type checking, lint, formatting and diff checks pass. Both clinic stacks
were stopped after guaranteed evidence capture.

The two changed TypeScript files passed UBS with zero critical findings and two
reviewed warnings (the existing disposable database test's synchronous secret-file
read and the checked-in account fixture assertion). Scan exit status was zero.
This does not replace the broader scan limitations above.

Follow-up artifacts under `test-results/m0-24d/`:

- `public-origin-compose-4.json`: SHA-256
  `42e0b4aa3a0b01828e6a44243b404f497c874e7421e2dd11ce9d1390f3bc838e`.
- `public-origin-ubs.log`: SHA-256
  `90a7e9259e57111ca372b3e156e2deccc5008ede1197ccf7f79059d223b235d7`.

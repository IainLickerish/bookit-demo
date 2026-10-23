# M0-24b: clinic administration

Bead: `supportagents-m0-24b-stl`. Requirements: REQ-18.1-01 and REQ-18.1-03.
Baseline: `c35507f` (BookIt operations endpoints, PR #2). The owner approves and merges PR #1, then PR #2,
then this change, retargeting each stacked PR to `main` after its predecessor merges. No deployment or
default-branch push is part of this change.

## Behaviour

An admin's navigation now links to `/admin`. The bookings table filters by practitioner, clinic-local date and status.
Inactive practitioners remain available for historical filters. Date boundaries are computed in the clinic's time
zone, including the 25-hour London clock-change day. Export uses the same filters and is returned as an uncached
UTF-8 CSV attachment with a byte-order mark, CRLF records and RFC 4180 quoting. Formula-leading cells are prefixed
with an apostrophe so spreadsheets treat untrusted text as text.

`GET /api/admin/reports?type=bookings` returns the filtered rows. `type=summary` returns total, confirmed, cancelled
and late-cancellation counts. Unknown or repeated report types return plain status 400 with `Unknown report type`.
Invalid, repeated or unknown filter parameters, including tenant/database selectors, return status 400. The request
cannot select a database. Each server's database and its current authenticated session determine the clinic scope.
Missing/expired/forged sessions return 401; a patient session returns 403. Every request rereads the current role.

`/admin/settings` edits clinic name, time zone, the late-cancellation window (whole hours from 0 to 336) and whether
confirmation emails include contact details. Other booking settings are preserved. The server action rechecks admin
access on every submission, including a privileged tab left open after another tab signs in as a patient.
Invalid input makes no write. Export logs contain tenant and row count, with no patient names, credentials or CSV body.

## Validation

Tests use Node 24.22.1, Bun 1.4.4, Vitest 5.0.5, Playwright 1.64.1 and disposable PostgreSQL 17 containers.

| Layer                                                               | Result                                                                                                      |
| ------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Full Vitest suite, `bun run test`                                   | 140/140 passed across 18 files, including production and test-clock Next.js builds and existing regressions |
| Focused admin tests after adding teardown evidence/redaction checks | 19/19 passed: 12 unit and seven integration tests                                                           |
| Full browser suite                                                  | 14/14 passed, including both admin journeys and all existing booking/operations journeys                    |
| Static checks                                                       | Type checking and lint passed; formatting checked separately after the final fixture formatting pass        |

The later test-only edits add evidence metadata, a synthetic canary rejection test and a stale-tab browser test.
Application code is unchanged from the full Vitest run. Browser runs set `BOOKIT_E2E_SKIP_BUILD=1` to reuse the
test-clock build produced by the passing startup suite; they still create fresh databases and run every selected
assertion. This flag skips compilation only. The ordinary startup suite also proves production builds refuse the
test clock. The first browser attempt exposed a test's assumption about a hidden form field after hydration;
the final test submits the actual stale browser form and proves the unauthorised write is refused.

Integration checks cover BOM bytes, Unicode names, commas/quotes/embedded newlines, date/status/practitioner filters,
current-role changes, expired sessions, foreign-clinic sessions, unknown report types and settings write boundaries.
The browser journey downloads and opens the CSV, edits all four settings, rejects an invalid time zone, and tries a
settings write from the stale admin tab with a patient session. The fictional seed fixture includes Zoë Brontë,
Łukasz Wiśniewski and Siobhán Ó Briain; M0-24d owns carrying those names into the full demo seed and user guide.

## Retained evidence

The committed sample [M0-24b-bookings.csv](M0-24b-bookings.csv) is an actual export opened by the test. It contains
fictional fixture data only. This report and sample provide durable evidence alongside the ignored raw bundle under
`test-results/m0-24b/`. Per-test JSON is written in teardown on success or failure and records source/config/fixture
hashes, expected and observed outcomes, actor roles, endpoints and privacy-safe admin events. A canary match withholds
the logs and fails the evidence check; the canary value is never written to the report.

SupportAgents case, Change, action, policy, model/provider and data-access records, connector call logs and audit
sequence ordering are not applicable to this BookIt-only feature. The evidence names this boundary explicitly.
Cross-clinic denial is exercised with two separate databases; SupportAgents network-denial proofs stay with the
runtime security beads. No live model, real email service or hosted Sentry service is used by these checks.

| Retained artifact                                                | SHA-256                                                            |
| ---------------------------------------------------------------- | ------------------------------------------------------------------ |
| `full-vitest-140.json`                                           | `09899560bf39d8e857589a13aa1fc0cdcc5a3393c2189c6069ae74db72060654` |
| `final-focused-vitest.json`                                      | `26f4da4665b63aeb361d463f6073d2e764b23fbb19ad8109480e41093d1ae1ca` |
| `full-playwright-14.json`                                        | `79dd321fbb4137d2ef4badb1c1df0fd0b61c2678a08634e39a1deeac1b523273` |
| `final-admin-playwright.json`                                    | `63ae48638badb0830b60e6b87f7ef65cb3fc1e9afb828eadbdb708c0a5bd0d33` |
| `integration-f8f9ca94-de1b-439d-973a-e5885035440d/evidence.json` | `2c047168322b56bdd87f3dce1bf00b2a4185d2f7e8190d9a498ad6b328c762ac` |
| Committed CSV sample                                             | `fa30dc26d44168bf34d4cd274e7d4fb54d2a4d28f58e088a75f087c9554c6c8c` |

Artifact names above are relative to `test-results/m0-24b/`, except the committed CSV sample. Final focused selection:
`bun x vitest run tests/unit/admin-csv.test.ts tests/integration/admin-reports.int.test.ts` and
`BOOKIT_E2E_SKIP_BUILD=1 bun x playwright test --grep admin` (two of two passed).

## UBS review

The initial `ubs .` timed out in its JavaScript module and is not a passing scan. Repeating the whole-source scan
with generated Next.js output, dependencies and test-output directories excluded completed: 111 files, seven
critical-labelled findings and 28 warnings. The seven findings are existing false positives: three comparisons of
error/role labels or empty input (not secret equality), two deliberately fake test passwords, and two Buffer
collection/decompression operations in the local Sentry receiver (not object-property merges).

The required changed-file scan completed with exit 0: 16 files, zero critical findings and two warnings. Both
`js.security.header-injection` warnings point to `src/server/admin/http.ts`; every response header there is a fixed
literal, including the attachment filename. Request-derived data is only in the body, never in a header. The
repository-wide warnings additionally cover existing test JSON parsers, assertions and the local receiver's
promise handling; they do not identify a new admin defect. No scanner rule was disabled or source finding suppressed.

Retained logs: `ubs-changed.log` SHA-256
`37373ef15222f5d88fa1b8811600bfc9656c690b24e4194278699ed38044a624`; `ubs-authored.log` SHA-256
`e8ed73fb06b80d0e63daf2c91f79cba2489cb2dd3201a6a395dbb19343ccff8e`, both under `test-results/m0-24b/`.

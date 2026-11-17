# Premium design review

The five design steps share one palette, typography scale and set of controls. This review covers Acme Physio and
Beacon Dental with their configured names and original wording. It uses fictional accounts and separate disposable
databases, never live data (PS-6, PS-7).

## Page and state coverage

`tests/e2e/shared-design.spec.ts` reviews each of these states for both clinics at 1280px, 320px and 200% CSS zoom in
a 640px viewport. It saves a screenshot of each state and checks local font loading, serif heading order, pine focus,
control sizes, field widths, text contrast, field border contrast and page containment (DS-1 to DS-6, DS-9).

| Page                  | States reviewed                                                                        |
| --------------------- | -------------------------------------------------------------------------------------- |
| Home                  | Visitor redirect to sign-in, client arrival at My bookings, staff administration home  |
| Sign in               | Standard form, refused credentials, password changed notice                            |
| Forgot password       | Entry form and neutral sent notice                                                     |
| Choose a new password | Valid link, mismatched passwords, weak password, invalid or expired link               |
| Available times       | Offered times and an empty day                                                         |
| Booking confirmation  | Available time with optional phone field and fixed phone action, unavailable time      |
| Moving                | Available choices, exhausted move allowance, cancelled booking                         |
| My bookings           | Confirmed booking, cancellation notice and cancelled booking, error notice, empty list |
| Clinic bookings       | Unfiltered and filtered rows, cancelled status, empty selection, invalid filters       |
| Clinic settings       | Form, saved notice, invalid values, unavailable notice                                 |
| Page not found        | Existing title and return link                                                         |
| Error                 | Existing title, explanation and retry action                                           |

`tests/e2e/bookings-list.spec.ts` adds past and late-cancelled records, a deliberately long fictional practitioner name
and a date that falls on a different UTC day from the clinic's day. The booking and account page tests cover short
phones, enlarged fallback content and unavailable booking states. The owner evals cover the unchanged recovery,
optional phone, booking, movement, cancellation, privacy and clock-change journeys (PR-4, EN-5).

## Staff layout and keyboard review

Staff pages use at most 1120px. Settings fields stay within 720px. Table headings use stone; Confirmed and Cancelled
use the same named pills as My bookings. The table keeps its caption and column headings and gains a labelled,
focusable scrolling region. Tab reveals its pine ring; arrow keys scroll columns inside the region (DS-4, DS-5).
The staff visual eval filters a booking it creates, then checks desktop width, keyboard scrolling on a narrow screen,
phone containment and 200% zoom. Filter choices and export query values are checked together.

The zoom review caught cramped filter columns. Filter and time grids now use their available width, and day
navigation uses its card width, so enlarged controls reflow into readable rows. Client reading widths are unchanged.

## Scope and final review

The branch retains every existing page title, description, clinic term, form field, route and action. No descriptions,
locations or confirmation steps were invented. Server actions, access checks, booking rules, database definitions,
email generation and exports are unchanged (PR-15 to PR-18, EN-4). Emails remain plain text; captured local booking
mail is checked for this. The existing known faults remain outside this visual change.

Font files and SIL licence notices are local assets. The runtime image includes those assets. No font provider or new
recipient receives page or booking data. No dependency or workflow changes were added. The earlier mocked database
cleanup test isolates its setup from the factory's database address while retaining its assertions (EN-2).

The design evals from each completed step are retained, with one additional staff visual eval in
`evals/14-staff-design.eval.ts`. Existing owner evals are unchanged. Each design eval has a precise title and three to
eight screenshot steps. The staff eval fails against the preview from before staff styling, where the shared staff
title header is absent.

The application browser review uses a local Chromium executable and the supplied test database server. Docker is
not installed in this build runner, so the separate Compose container browser checks require the normal CI runner.
No test was removed, skipped or weakened to work around that environment limit.

# Look and feel

BookIt should feel calm, assured, warm and quietly premium, like a well-kept clinic reception. The clinic leads:
its configured name is the wordmark, with no separate logo. This guide follows the Design policy of 12 November
2026 (DS-1 to DS-6 and DS-9), replacing the earlier grey, teal and all-sans-serif appearance in UX-3 and UX-4.
The existing journeys, clinic words and plain-text emails stay as they are.

## One shared foundation

Both clinics use the tokens and components in `src/app/globals.css`. Do not add page-specific colours or duplicate
components. Keep BookIt's own warm ivory, pine and serif identity, separate from the Software Factory's pages.

| Colour                   | Use                                                                        |
| ------------------------ | -------------------------------------------------------------------------- |
| Ivory #FAF8F4            | Page background                                                            |
| White #FFFFFF            | Cards, fields, header and text on pine                                     |
| Ink #16241F              | Main text                                                                  |
| Muted #5A6862            | Details and hints                                                          |
| Line #E6E1D8             | Hairlines and dividers                                                     |
| Field border #8C9792     | Control outlines                                                           |
| Stone #F1EEE8            | Quiet hover fills, table headings, selected days and Cancelled backgrounds |
| Pine #1D5C4B             | Actions, links, focus, selections, success and Confirmed text              |
| Pine hover #164A3C       | Main-action hover                                                          |
| Sage #E9F1EC             | Success, Confirmed backgrounds, date tiles and quiet decoration            |
| Clay #B9603F             | Small decorative marks only, never words or buttons                        |
| Clay tint #F8E9E1        | Quiet decorative shapes                                                    |
| Amber #92400E on #FDF3E2 | Attention notices and Needs attention                                      |
| Brick #A8261B on #FCEBE8 | Problem notices; brick also marks field errors                             |

Text needs at least 4.5:1 contrast and controls at least 3:1. Hairlines do not substitute for field outlines. Every
meaning also needs words. Do not communicate status through colour alone.

## Type

Serve the bundled Fraunces and Figtree files from BookIt, with their SIL Open Font Licence notices in `public/fonts/`.
Never request fonts from another company when a page loads. The Latin and Latin Extended subsets support accents.

| Use                            | Typeface | Size and weight                        |
| ------------------------------ | -------- | -------------------------------------- |
| Clinic name                    | Fraunces | 500, slightly tight spacing            |
| Page title                     | Fraunces | 32px, 28px on phones, 500              |
| Section heading                | Fraunces | 22px, 500                              |
| Card title                     | Figtree  | 18px, semibold                         |
| Body                           | Figtree  | 16px, regular, 1.6 line height         |
| Labels, buttons and navigation | Figtree  | 15px, medium                           |
| Small print                    | Figtree  | At least 13px                          |
| Optional short eyebrow         | Figtree  | 12px, semibold, capitals, wide spacing |

Use real headings in order. Reserve the serif for the clinic name, page titles and section headings; use the
`card-title` class for a card heading. Use sentence case except for eyebrows. Dates and times in lists use the
`tabular-figures` class for even-width figures.

## Layout and reusable components

Design for phones first. The centred client column is at most 720px wide, with 20px side padding on phones and 32px
on larger screens. Staff tables and filters may use the 1120px staff width. Use the 8, 12, 16, 24, 32 and 48px spacing
rhythm: 8px within a group, 16px between fields, 24px inside cards and 32px to 48px between sections.

Every page opens with a short `page-header`: an optional eyebrow, a serif title and one line explaining the page.
Keep existing words and useful actions when refreshing the shared recovery screens. Give each decision one main
action and at most two quieter alternatives.

- `button`: pine with white words, pill shaped and at least 48px tall. Let long labels wrap without clipping.
- `button-secondary`: white pill with a fine control border. `text-link` is an underlined pine alternative.
- `card`: white, 20px corners, a hairline and a soft low shadow, with 24px padding. Never nest cards.
- `notice`, `notice-attention`, `alert`: rounded success, attention and problem banners near the top, with outline
  icons and words. Keep `role="status"` for results and `role="alert"` for errors on the element carrying the message.
- `status-pill` with `status-confirmed`, `status-cancelled` or `status-attention`: the words Confirmed, Cancelled or
  Needs attention on sage, stone or pale amber. A pill is a label, not a control.
- Forms: labels above full-width fields, at least 48px tall, with 12px corners. Put muted hints and brick errors
  directly below, pairing error icons with words. Optional labels say “(optional)”.
- Empty states: one calm sentence and one useful action, never a blank page.

The remaining page refreshes use the same foundation: sign-in and booking confirmation in a single card no wider
than 440px; day cards in a contained strip; time choices in a 48px pill grid with a tick for selection; booking cards
with a sage date tile and a labelled status pill; staff tables in their own scrolling area. Booking-step main actions
on phones use a bottom bar with space for content, safe areas and focus. These page layouts are separate from the
shared foundation and must preserve existing behaviour.

## Accessibility and motion

Meet WCAG 2.2 AA (DS-5). Check keyboard order, labels, headings, announcements, contrast, at least 44px touch targets
and 200% zoom. The shared `:focus-visible` treatment is a 3px pine outline with a 3px offset. Do not hide or clip it.
Allow the header and action groups to wrap. Keep horizontal scrolling within tables and phone day strips.

Use one family of 20px outline icons, with 1.5px strokes and rounded ends, always with words. Decorative images and
icons stay hidden from screen readers. No stock people, clip art, invented logo or decorative animation. Optional
quiet abstract shapes use sage and clay tint. Clay never carries meaning or words.

Only animate a change, for 150 to 200 milliseconds with ease-out timing. The shared reduced-motion rule switches
animations and transitions off when the device requests less motion. Nothing bounces, loops or moves by itself.

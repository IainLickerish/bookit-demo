# Look and feel

BookIt feels calm, assured, warm and quietly premium, like a good private clinic's reception. The clinic leads and
BookIt stays in the background. This guide follows the Design policy reviewed on 12 November 2026.

## Brand and colour

The configured clinic name is the wordmark, top left, in Fraunces at weight 500. Keep its spelling and never invent a
logo. Both clinics share one palette; their names and words give them their identities (DS-1, DS-8, DS-9).

| Colour                       | Use                                                                      |
| ---------------------------- | ------------------------------------------------------------------------ |
| Ivory `#FAF8F4`              | Page background                                                          |
| White `#FFFFFF`              | Header, cards, fields and text on pine buttons                           |
| Ink `#16241F`                | Main text                                                                |
| Muted `#5A6862`              | Details and hints                                                        |
| Line `#E6E1D8`               | Hairlines and dividers                                                   |
| Field border `#8C9792`       | Control outlines                                                         |
| Stone `#F1EEE8`              | Quiet hover fills, table headings, chosen days and Cancelled backgrounds |
| Pine `#1D5C4B`               | Actions, links, focus, selection outlines and Confirmed text             |
| Pine hover `#164A3C`         | Main action hover                                                        |
| Sage `#E9F1EC`               | Success, Confirmed backgrounds and date tiles                            |
| Clay `#B9603F`               | Small decoration only, such as the header dot                            |
| Clay tint `#F8E9E1`          | Quiet decorative shapes                                                  |
| Amber `#92400E` on `#FDF3E2` | Attention notices and Needs attention                                    |
| Brick `#A8261B` on `#FCEBE8` | Problems; brick also marks field error text                              |

Use only these colours. Pine is the action and link colour; clay never carries text or actions. Text contrast must
reach 4.5:1 and controls 3:1. Always give meaning in words as well as colour (DS-2). Do not borrow the Software
Factory's dark banners, teal or cartoon people (DS-9).

## Local typography

Fraunces and Figtree are served from BookIt's `public/fonts/`, with their SIL Open Font Licences. There are no remote
font requests. Latin and extended Latin subsets retain accented names. Emails remain plain text for this change.

| Use                            | Typeface | Size and weight                      |
| ------------------------------ | -------- | ------------------------------------ |
| Clinic name                    | Fraunces | 24px, 500                            |
| Page title                     | Fraunces | 32px, 28px on phones, 500            |
| Section heading                | Fraunces | 22px, 500                            |
| Card title                     | Figtree  | 18px, 600                            |
| Body                           | Figtree  | 16px, 400, line height 1.6           |
| Labels, buttons and navigation | Figtree  | 15px, 500                            |
| Small print                    | Figtree  | 13px minimum                         |
| Optional short eyebrow         | Figtree  | 12px, 600, capitals and wide spacing |

Use slightly tight letter spacing for the serif. Use real headings in order and sentence case apart from eyebrows.
Keep serif type out of forms, buttons and body text. Use even-width figures for dates and times (DS-3).

## Page frame and spacing

The shared `.page-shell` centres client content within 720px, including its gutters. `.page-shell-wide` allows
1120px for staff. Side gutters are 20px on phones and 32px from 640px upwards. The white header wraps its text
navigation when space is limited; all destinations keep their existing names and routes.

Use an 8px rhythm, with 8, 12, 16, 24, 32 and 48px spaces. Cards have 24px padding; sections have 32px to 48px gaps.
Every screen's short `.page-header` contains an optional `.eyebrow`, its serif title and one line explaining the page.
Sign-in and booking confirmation use a single centred card no wider than 440px. Never nest cards.

On phones, booking steps place the main action in a fixed bottom bar, with space below the content so nothing is
hidden. Keep scrolling within tables and phone day strips, without sideways page scrolling (DS-4).

This foundation step supplies the shared frame and reusable styles. Applying page headers, cards, day and time
choices, booking summaries, status pills and bottom bars to individual screens belongs to the later screen steps.

## Reusable building blocks

Reuse `src/app/globals.css` rather than introducing one-off colours or styles (EN-4).

- `.button`: pine pill, white text, 48px minimum height; darker pine on hover.
- `.button-secondary`: white pill, field-colour border, pine text, 48px minimum height; stone on hover.
- Links and `.link`: underlined pine. Header destinations remain text-led, with at least 44px touch height.
- `.card`: white, 20px corners, line border, soft low ink shadow and 24px padding.
- `.card-centred`: limit a card to 440px and centre it.
- `.page-header` and `.eyebrow`: consistent space for each screen's title and introduction.
- Fields: full width, 48px minimum height, 12px corners, labels above. Checkbox and radio labels provide 44px targets.
- `.field-hint`: muted text below the field. Optional fields say “(optional)” in their labels.
- `.field-error`: brick text directly below the field, paired with an icon and linked to the field.
- `.notice`, `.notice-attention` and `.alert`: rounded sage, amber and brick banners near the top, each with an outline
  icon and explanatory words. Use `role="status"` for results and `role="alert"` for errors.

Each step has one main action and at most two quieter ones. Empty states have one calm sentence and a useful action.
Time choices are 48px pills, with a tick and pine fill when selected. Day cards show day above date, a clay dot for
today and a pine outline on stone for the chosen day. Booking cards place a sage date tile to the left and a status
pill to the right. Confirmed uses pine on sage, Cancelled muted on stone and Needs attention amber on its tint (DS-5).

## Accessibility, decoration and motion

Meet WCAG 2.2 AA throughout: labelled fields, ordered headings, keyboard access, a visible pine focus ring, touch
targets of at least 44px, readable contrast, 200% zoom and announced results and errors (DS-5). The shared styles
provide focus rings and minimum control sizes; every screen still needs its own accessibility check.

Use one family of 20px outline icons with 1.5px strokes and rounded ends, in ink or pine. Pair icons with words and
hide decorative images from screen readers. A quiet sage or clay-tint abstract shape may decorate open space; keep
it away from important content. No stock photographs or clip art (DS-6).

Motion only explains a change, lasts 150 to 200ms and eases out. Nothing loops, bounces or moves by itself. Disable
motion when the device requests less (DS-6).

Keep existing clinic words and the calm UK English house style in [Writing for BookIt](writing.md) (DS-7, DS-8).

# Look and feel

BookIt feels calm, assured, warm and quietly premium, like a well-kept private clinic reception. The clinic leads:
its configured name is the wordmark, with no separate logo. BookIt has its own look, without the Software Factory's
dark banners, cartoon people or teal. This guide follows the Design policy reviewed on 12 November 2026.

The shared foundation is in place. Individual page layouts, booking cards, day and time choices, mobile action
bars and page introductions are applied in the later client and staff presentation steps. Those steps preserve
existing wording and journeys. Emails stay plain text.

## Colours

Both clinics use the same palette. Their names and words distinguish them, not their colours (DS-1, DS-2, DS-9).

| Colour                       | Use                                                                            |
| ---------------------------- | ------------------------------------------------------------------------------ |
| Ivory `#FAF8F4`              | Page background                                                                |
| White `#FFFFFF`              | Header, cards, fields and text on pine buttons                                 |
| Ink `#16241F`                | Main text                                                                      |
| Muted `#5A6862`              | Quieter details and hints                                                      |
| Line `#E6E1D8`               | Hairlines and dividers                                                         |
| Field border `#8C9792`       | Field outlines and secondary button borders                                    |
| Stone `#F1EEE8`              | Quiet hover fills, table headings, chosen days and Cancelled backgrounds       |
| Pine `#1D5C4B`               | Actions, links, focus rings, chosen times, selection outlines and success text |
| Pine hover `#164A3C`         | Main action hover                                                              |
| Sage `#E9F1EC`               | Success and Confirmed backgrounds, date tiles and quiet decoration             |
| Clay `#B9603F`               | Small decoration only, such as the shared header's dot                         |
| Clay tint `#F8E9E1`          | Soft decorative shapes                                                         |
| Amber `#92400E` on `#FDF3E2` | Attention and Needs attention                                                  |
| Brick `#A8261B` on `#FCEBE8` | Problems; brick also marks field errors                                        |

Use only this palette. Clay never carries words or actions. Text needs at least 4.5:1 contrast and controls at
least 3:1. Always express meaning in words as well as colour.

## Type

Fraunces is reserved for the clinic name, page titles and section headings. Figtree is used everywhere else.
Both are served from BookIt's own `public/fonts/`, including Latin Extended characters, with their SIL Open Font
Licences. No visitor requests a font from another company (DS-3).

| Use                                  | Typeface | Size and weight                                                     |
| ------------------------------------ | -------- | ------------------------------------------------------------------- |
| Clinic name                          | Fraunces | 24px, 500, slightly tight spacing                                   |
| Page title                           | Fraunces | 28px on phones, 32px on larger screens, 500, slightly tight spacing |
| Section heading                      | Fraunces | 22px, 500, slightly tight spacing                                   |
| Card title                           | Figtree  | 18px, semibold                                                      |
| Body                                 | Figtree  | 16px, regular, 1.6 line height                                      |
| Labels, buttons and navigation       | Figtree  | 15px, medium                                                        |
| Small print                          | Figtree  | 13px minimum                                                        |
| Optional short eyebrow above a title | Figtree  | 12px, semibold, capitals and wide spacing                           |

Use real headings in order. Use sentence case except for eyebrows. Dates and times in lists use even-width
figures. Never put serif type in forms, buttons or body text.

## Shared layout

The shared header is white with a fine divider, the clinic name at the top left and text navigation alongside it.
On small screens, navigation wraps below the name, and long configured names wrap instead of being clipped.
Keep the existing destinations and role-specific navigation (DS-1, DS-4, DS-5).

Client content uses a centred column up to 720px wide; staff content can widen to 1120px. The shared header follows
the same width. Side padding is 20px on phones and 32px from 640px upwards. The shared `content-shell` and
`content-width-staff` classes provide these limits.

Use 8, 12, 16, 24, 32 and 48px spacing: 8px within a group, 16px between fields, 24px in cards and 32px to 48px between
sections. Tables and phone day strips scroll inside their own areas, never across the whole page (DS-4).

## Reusable components

Reuse the classes in `src/app/globals.css`, rather than creating one-off styles (EN-4).

- `page-header`: a short introduction with the serif title and an existing line explaining the page. An optional
  `eyebrow` sits above the title. Page-specific introductions are part of the later steps.
- `card`: white, 20px corners, a hairline border, 24px padding and a soft, low shadow. Never nest cards. Sign-in and
  booking confirmation will each use one centred card up to 440px wide in the client presentation step.
- `button`: pine with white words, pill corners and at least 48px height. Use one main action per step.
- `button-secondary`: a white pill with a fine outline and pine words. Allow at most two quieter actions. The
  quietest choice is an underlined pine link.
- Fields: labels above full-width white fields at least 48px tall, with 12px corners. Hints go below in muted;
  errors directly below in brick with an icon. Optional labels say “(optional)”.
- `notice`: a sage banner with pine text and a decorative outline tick. Keep the existing announced result.
- `alert`: a pale brick banner with brick text and a decorative outline attention icon. Keep the existing error
  announcement. Icons accompany words and never supply meaning alone.

Later page presentation uses the same policy components: 48px pill time choices with a tick when selected;
small day cards with a clay today dot and a pine selected outline on stone; booking cards with sage date tiles;
and Confirmed, Cancelled and Needs attention status pills. Empty lists keep a calm explanation and a useful action.
Booking steps will have a phone action bar with enough content space above it (DS-4, DS-5).

## Accessibility and decoration

Meet WCAG 2.2 AA for the parts being changed: keyboard access, labelled fields, ordered headings, strong contrast,
visible pine focus rings, targets at least 44px and use at 200% zoom. Announce results and errors with their existing
roles. Check the shared header on phones and laptops for clients and staff in both clinics (DS-5).

Icons use simple outlines, 20px, 1.5px strokes and rounded ends, in ink or pine.
Keep decoration away from important content and hidden from screen readers. No stock photos or clip art.
The foundation adds no motion. Later motion may only show a change, lasts 150 to 200 milliseconds and switches off
when reduced motion is requested (DS-6).

Wording follows `writing.md`, each clinic's vocabulary and DS-7 to DS-8. This visual change does not change words,
booking rules, account behaviour, permissions, stored data or plain-text emails.

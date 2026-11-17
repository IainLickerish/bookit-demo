# Look and feel

BookIt feels calm, assured, warm and quietly premium, like a well-kept clinic reception. The clinic leads and BookIt
stays in the background. Follow the owner's Design policy reviewed on 12 November 2026.

## Brand and colours

Under DS-1 and DS-9, the configured clinic name is the wordmark, at the top left in Fraunces. Keep its spelling and
capitalisation. There is no separate logo. Both clinics share this palette, distinct from the Software Factory's look.

| Use                                                                  | Colour                       |
| -------------------------------------------------------------------- | ---------------------------- |
| Page                                                                 | Ivory `#FAF8F4`              |
| Header, cards, fields, text on pine buttons                          | White `#FFFFFF`              |
| Main text                                                            | Ink `#16241F`                |
| Hints and quiet details                                              | Muted `#5A6862`              |
| Hairlines                                                            | Line `#E6E1D8`               |
| Field outlines                                                       | Field border `#8C9792`       |
| Quiet hover fills, table headings, chosen day, Cancelled backgrounds | Stone `#F1EEE8`              |
| Actions, links, focus, selections, success and Confirmed text        | Pine `#1D5C4B`               |
| Main action hover                                                    | Pine hover `#164A3C`         |
| Success, Confirmed, date tiles and quiet decoration                  | Sage `#E9F1EC`               |
| Small decoration only                                                | Clay `#B9603F`               |
| Soft decorative shapes                                               | Clay tint `#F8E9E1`          |
| Attention                                                            | Amber `#92400E` on `#FDF3E2` |
| Problems and field errors                                            | Brick `#A8261B` on `#FCEBE8` |

DS-2 requires at least 4.5:1 text contrast and 3:1 control contrast. Pine is the action and link colour. Clay never
carries text or an action. The shared header has one small clay dot, hidden from screen readers. Meanings always
have words as well as colour.

## Type

Under DS-3, serve both fonts from BookIt itself. Keep the SIL Open Font Licence notices with the local files in
`public/fonts/`. Never fetch fonts from another company when a page loads.

| Use                            | Typeface | Size and weight                             |
| ------------------------------ | -------- | ------------------------------------------- |
| Clinic name                    | Fraunces | 500, slightly tight spacing                 |
| Page title                     | Fraunces | 28px on phones, 32px on larger screens, 500 |
| Section heading                | Fraunces | 22px, 500                                   |
| Card title                     | Figtree  | 18px, 600                                   |
| Body                           | Figtree  | 16px, 400, line height 1.6                  |
| Labels, buttons and navigation | Figtree  | 15px, 500                                   |
| Small print                    | Figtree  | 13px minimum                                |
| Optional short eyebrow         | Figtree  | 12px, 600, capitals and wide spacing        |

Use real headings in order. Reserve the serif for clinic names, page titles and section headings. Lists of dates and
times use even-width figures. Use sentence case except for short eyebrow labels.

## Shared building blocks

Reuse `globals.css` classes under EN-4. DS-5 requires labelled fields, visible pine keyboard focus, touch targets of
at least 44px, usable layouts at 200% zoom and announced results and errors.

- `.button`: a pine pill with white text, at least 48px tall, with darker pine on hover.
- `.button-secondary`: a white pill with a fine field-colour border, pine text and a stone hover fill.
- Links: underlined pine text. Navigation stays text-led and wraps on small phones.
- Fields: full width, at least 48px tall, with 12px corners and labels above. Checkboxes sit in comfortable labelled
  targets. Optional fields say “(optional)”. Hints are muted; field errors sit directly below in brick.
- `.card`: white, with 20px corners, a hairline border, 24px padding and a soft low shadow. Never nest cards.
- `.notice`: a rounded sage banner with pine text and a decorative outline tick. Keep its status announcement.
- `.alert`: a rounded pale brick banner with brick text and a decorative outline warning. Keep its alert announcement.

DS-6 uses 20px outline icons with a 1.5px stroke and rounded ends, paired with words. Icons add no extra spoken
content. Motion only shows a change, lasts 150 to 200 milliseconds and eases out. Switch it off when reduced motion
is requested. No stock people, clip art or self-running animation.

## Page layouts

DS-4 sets a centred client column up to 720px, with 20px phone margins and 32px on larger screens. Staff pages may
widen to 1120px. Use 8, 12, 16, 24, 32 and 48px spacing: 8px within groups, 16px between fields, 24px inside cards and
32px to 48px between sections.

Each page opens with its short title header and any existing description. Put action messages near the top. Sign-in
and booking confirmation each use one centred card up to 440px. On phones, an existing booking step's main action
can sit in a bottom bar with enough content space above it. Keep table scrolling, and any phone day strip scrolling,
inside its own area rather than widening the page.

The full reskin is being built in stages. These are the standards for the remaining page work, not new journeys or
new wording. This look-only change preserves every current title, description, clinic term and action. Emails stay
plain text. Separate confirmation steps, additional messages and other behaviour changes need their own decision.

The account, administration home and fallback pages now use `PageHeading` for the existing title and any existing
introduction. Their `.page-shell` adds to the root content gutters to give 20px phone margins and at least 32px on
larger screens. Account forms use a single `.card.account-card`, centred and no wider than 440px; home and fallback
cards stay within the reading column. `.page-actions` gives their existing text links a comfortable tap target.
These changes do not add descriptions or destinations, or alter the recovery journey.

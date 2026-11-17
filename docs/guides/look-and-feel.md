# Look and feel

Calm, assured, warm and quietly premium: the reception of a good private clinic, unhurried, beautifully kept and
clearly on top of the details. The clinic leads; BookIt stays in the background. Each rule has a short ID (DS-1 and so
on) so a review can name it.

**Today's pages** still use an older, plainer look: teal buttons and notices on a light grey background. The look
below is the standard. Until every page has been reskinned to it, a small change matches the page it is on, and a new
page, or a page being reskinned, uses this look.

## The clinic's name

- **DS-1** The clinic's name, in its configured spelling and the display serif, sits at the top left of every page
  and at the top of every email. There is no separate logo, and none is invented.
- **DS-2** BookIt has a look of its own: warm ivory, pine green and a serif for titles. It never borrows the Software
  Factory's dark banners, cartoon people or teal.

## Colours

One palette for every clinic. Clinics differ by their name and words, never by colour.

| Colour                  | Use                                                                                     |
| ----------------------- | --------------------------------------------------------------------------------------- |
| Ivory #FAF8F4           | Page background                                                                         |
| White #FFFFFF           | Cards, fields and the header; text on pine buttons                                      |
| Ink #16241F             | Main text                                                                               |
| Muted #5A6862           | Quieter details and hints                                                               |
| Line #E6E1D8            | Hairlines and dividers                                                                  |
| Field border #8C9792    | Field outlines                                                                          |
| Stone #F1EEE8           | Quiet hover fills, table headings, the chosen day, the Cancelled status                 |
| Pine #1D5C4B            | Main actions, links, focus rings, chosen times and outlines; success and Confirmed text |
| Pine hover #164A3C      | A main action under the pointer                                                         |
| Sage #E9F1EC            | Success and Confirmed backgrounds, date tiles, quiet decoration                         |
| Clay #B9603F            | Small decorative marks, such as today's date dot                                        |
| Clay tint #F8E9E1       | Soft decorative shapes                                                                  |
| Amber #92400E / #FDF3E2 | Attention notices and the Needs attention status                                        |
| Brick #A8261B / #FCEBE8 | Problems and error notices; brick also marks a field's error text                       |

Contrast: ink on ivory 15:1, muted on ivory 5.5:1, white on pine 7.8:1, amber 6.4:1 and brick 6.1:1 on their
backgrounds, field borders 3:1. Clay on ivory is only 4.1:1, so it never carries words.

- **DS-3** Use only this palette. Pine is the only colour for actions and links; clay is decoration only, never text or
  buttons. Text contrast is at least 4.5:1 and controls at least 3:1, and every meaning is also given in words.

## Type

Two typefaces, both served from BookIt itself (never fetched from another company when a page loads), both under the
SIL Open Font Licence: Fraunces, a soft display serif, at weight 500 with slightly tight letter spacing; and Figtree,
a clean sans-serif, for everything else.

| Use                    | Typeface and size              | Detail                            |
| ---------------------- | ------------------------------ | --------------------------------- |
| Clinic name            | Fraunces                       | 500, slightly tight               |
| Page title             | Fraunces, 32px (28px on phone) | 500, slightly tight               |
| Section heading        | Fraunces, 22px                 | 500, slightly tight               |
| Card title             | Figtree, 18px                  | Semibold                          |
| Body                   | Figtree, 16px                  | Regular, line height 1.6          |
| Labels, buttons, menus | Figtree, 15px                  | Medium                            |
| Small print            | Figtree, 13px                  | Never smaller, except the eyebrow |
| Eyebrow above a title  | Figtree, 12px                  | Semibold, capitals, wide spacing  |

Times and dates in lists use even-width figures so they line up.

- **DS-4** Use these two typefaces and this scale, with real headings in order. The serif is for the clinic's name,
  page titles and section headings only, never buttons, forms or body text.

## Layout and spacing

Phone first and roomy. Client pages are one centred column, at most 720px wide, with 20px side margins on phones and
32px on larger screens; staff pages may widen to 1120px for tables and filters. Every page opens with a short header:
an optional eyebrow, the serif title and one line saying what the page is for. Spacing follows an 8px rhythm (8, 12,
16, 24, 32, 48): 8px within a group, 16px between fields, 24px inside cards, 32 to 48px between sections. Sign-in and
the booking confirmation each sit in one centred card, at most 440px wide. On phones, each booking step's main action
sits in a bar fixed to the bottom of the screen, with room below the content so nothing hides behind it.

- **DS-5** Design for a thumb on a phone first, then check staff pages on a laptop. Only tables, and the day strip on
  phones, may scroll sideways, inside their own area; the page itself never does.

## Building blocks

- Buttons: the main one is a pine pill with white text, 48px tall; the secondary one is a white pill with a fine
  border; the quietest choice is an underlined pine link.
- Cards: white, with 20px rounded corners, a hairline border and a soft, low shadow. Never a card inside a card.
- Times: a grid of 48px pill buttons; the chosen time fills pine and shows a tick.
- Days: small day cards with the day's name above the date. Today has a clay dot; the chosen day is stone with a pine
  outline.
- Bookings: a card with a date tile on the left (day and month, on sage), then the time large, who and where, and a
  status pill on the right.
- Status pills: Confirmed is pine on sage, Cancelled is muted on stone, Needs attention is amber on its pale background.
- Forms: labels above full-width 48px fields with 12px rounded corners; hints below in muted; errors directly under the
  field in brick with an icon; optional fields say "(optional)" in the label.
- Notices: a soft rounded banner near the top, with an icon: sage for done, amber for attention, brick for problems.
- Empty states: one calm sentence and one useful action, such as choosing another day. Never a blank page.

- **DS-6** Give each step one main action and at most two quieter ones, built from these blocks.
- **DS-7** Meet WCAG 2.2 AA everywhere: labelled fields, keyboard access, a visible pine focus ring, touch targets of at
  least 44px, pages that work at 200% zoom, and results and errors announced to screen readers.

## Icons, pictures and motion

One family of simple outline icons, 20px, with a 1.5px stroke and rounded ends, in ink or pine. No stock photos of
people and no clip art. Open spaces, such as sign-in, an empty bookings list or the booking confirmation, may carry one
soft abstract shape in sage and clay tint, behind nothing important and hidden from screen readers. Motion is quick
and quiet (150 to 200 milliseconds, easing out) and only shows a change, such as a time being chosen or a notice
arriving. Nothing bounces, loops or moves on its own.

- **DS-8** Pair every icon with words, use pictures only as quiet decoration, and animate only to show a change,
  switching motion off when someone's device asks for less.

# Shared design foundation: font check investigation

The step 1 design changes remain on this branch. The owner accepted the proposed font check correction. The
current run explicitly permits fixing evals added on this branch, so the correction is now applied under EN-5.
Checks inherited from `sf-base` are unchanged. The application has not been altered to work around the faulty check.

## Finding

`evals/10-local-fonts.eval.ts`, line 14, supplies `node.textContent ?? ''` to `document.fonts.load()`. Its first step
checks `sign-in-email`, an empty HTML input. An input has no text content, including when someone enters a value.
The supplied text is therefore an empty string. Loading a font for empty text returns an empty array, so the
following `fonts.length > 0` condition fails even when Figtree has loaded correctly.

This was reproduced in an isolated Chromium 153.0.8010.0 page using BookIt's actual `src/app/fonts.css` and bundled
WOFF2 files. Requests were intercepted and served from the repository under the fictional `http://bookit.test`
origin. No running clinic, account, database or owner eval was used.

| Probe                                                             | Result                       |
| ----------------------------------------------------------------- | ---------------------------- |
| Fraunces 500, using clinic names and accented text                | Font returned, status loaded |
| Figtree 400, 500 and 600, using clinic names and accented text    | Font returned, status loaded |
| Figtree 400, using the empty input's text content                 | Empty array, check false     |
| Figtree 400, using a space when the input's text content is empty | Font returned, check true    |
| Font requests                                                     | Only local `/fonts/` URLs    |

The same empty-text result also occurred without the CSS subset ranges. Changing the font files or their ranges
does not correct the check's input.

## Applied correction

In the font eval added by this branch, the only change replaces:

```ts
node.textContent ?? '';
```

with:

```ts
node.textContent || ' ';
```

The space provides a character to check for empty form controls. The assertions still require the correct computed
font family and a non-empty collection of successfully loaded font faces. The checks for local requests, licences,
weights and both page sizes remain unchanged. The check still fails if the font is absent or fails to load.

## Validation

`bun install --frozen-lockfile`, `bun run typecheck`, `bun run lint`, `bun run format:check` and `bun run test:unit`
passed, with 147 unit tests passing. The isolated browser probe above passed the proposed font-loading check and
reproduced the existing check's failure.

The factory's evals were not run. Integration and full browser journeys were not run because this environment has
no Docker. The usual Playwright browser download was blocked; the isolated probe used a temporary Chromium binary
outside the repository, without adding a dependency or changing the lockfile. This probe does not establish that
the full font eval passes against a running clinic.

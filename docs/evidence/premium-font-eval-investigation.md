# Shared design foundation: font check investigation

The step 1 design changes remain on this branch. The owner has replied “Yes” to the proposed font check correction,
meeting the approval requirement in EN-5. However, the current run also explicitly says “Never change or delete
existing files under evals/”. That instruction still prevents applying the correction. No existing eval has been
changed, and the application has not been altered to work around the faulty check.

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

## Proposed correction, not applied

In the existing font eval, replace only:

```ts
node.textContent ?? '';
```

with:

```ts
node.textContent || ' ';
```

The space provides a character to check for empty form controls. The assertions still require the correct computed
font family and a non-empty collection of successfully loaded font faces. The checks for local requests, licences,
weights and both page sizes remain unchanged. Applying this proposal requires an explicit exception to the current
run's instruction forbidding changes to existing eval files, limited to this expression in the font check.

## Validation

`bun install --frozen-lockfile`, `bun run typecheck`, `bun run lint`, `bun run format:check` and `bun run test:unit`
passed, with 147 unit tests passing. The isolated browser probe above passed the proposed font-loading check and
reproduced the existing check's failure.

The factory's evals were not run. Integration and full browser journeys were not run because this environment has
no Docker. The usual Playwright browser download was blocked; the isolated probe used a temporary Chromium binary
outside the repository, without adding a dependency or changing the lockfile. This probe does not establish that
the full font eval passes against a running clinic.

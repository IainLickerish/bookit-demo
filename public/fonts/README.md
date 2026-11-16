# BookIt's local fonts

These unmodified WOFF2 files are bundled with BookIt and served from `/fonts/`. Pages never load fonts from another
company. Both families use the SIL Open Font Licence 1.1; the full copyright and licence notices are alongside them.

- Fraunces: `@fontsource-variable/fraunces` 5.3.0, normal style, full variable axes, Latin, extended Latin and
  Vietnamese subsets. Original project: <https://github.com/undercasetype/Fraunces>.
- Figtree: `@fontsource-variable/figtree` 5.3.0, normal style, variable weight, Latin and extended Latin subsets.
  Original project: <https://github.com/erikdkennedy/figtree>.

Source archives:

- <https://registry.npmjs.org/@fontsource-variable/fraunces/-/fraunces-5.3.0.tgz>
- <https://registry.npmjs.org/@fontsource-variable/figtree/-/figtree-5.3.0.tgz>

The font files are assets, not runtime package dependencies. `src/app/globals.css` declares their original Unicode
ranges so accented clinic and practitioner names use the appropriate subset.

# Local typefaces

BookIt serves these WOFF2 files itself. No font service is contacted during builds or page loads.

The unmodified normal variable fonts come from Fontsource Variable 5.3.0, sourced from Google Fonts:

- Fraunces v38, weight axis 100 to 900: `@fontsource-variable/fraunces@5.3.0`.
- Figtree v9, weight axis 300 to 900: `@fontsource-variable/figtree@5.3.0`.

Latin and extended Latin subsets cover the clinic names and accented names in the fictional demonstration.
The accompanying `fraunces-OFL.txt` and `figtree-OFL.txt` contain the copyright notices and SIL Open Font Licence
1.1 terms allowing use and redistribution. These are bundled assets, not runtime package dependencies.

Source archives:

- https://registry.npmjs.org/@fontsource-variable/fraunces/-/fraunces-5.3.0.tgz
- https://registry.npmjs.org/@fontsource-variable/figtree/-/figtree-5.3.0.tgz

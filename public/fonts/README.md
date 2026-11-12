# BookIt's bundled fonts

Fraunces and Figtree are served from this directory, on BookIt's own origin. No page requests fonts or font styles
from an outside service. The original copyright and SIL Open Font Licence 1.1 notices are included alongside them.

These unmodified WOFF2 files are from Fontsource's `@fontsource-variable/fraunces` and
`@fontsource-variable/figtree`, both version **5.3.0**, using their normal `wght` subsets. The Latin and Latin Extended
subsets keep accented clinic and practitioner names available. Only the upright faces are used by this design.

- [Fraunces source](https://github.com/undercasetype/Fraunces)
- [Figtree source](https://github.com/erikdkennedy/figtree)
- [Fraunces distribution](https://registry.npmjs.org/@fontsource-variable/fraunces/-/fraunces-5.3.0.tgz)
- [Figtree distribution](https://registry.npmjs.org/@fontsource-variable/figtree/-/figtree-5.3.0.tgz)

`src/app/fonts.css` contains the subset ranges supplied with those distributions. Fraunces is used at weight 500;
Figtree supplies regular, medium and semibold text without synthesising those weights. Changing a font requires
keeping its licence and copyright notice with the replacement files.

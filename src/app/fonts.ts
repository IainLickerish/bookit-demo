import localFont from 'next/font/local';

export const figtree = localFont({
  src: [
    { path: './fonts/figtree-latin-400-normal.woff2', weight: '400' },
    { path: './fonts/figtree-latin-500-normal.woff2', weight: '500' },
    { path: './fonts/figtree-latin-600-normal.woff2', weight: '600' },
  ],
  variable: '--font-figtree',
  display: 'swap',
  preload: false,
});
export const fraunces = localFont({
  src: './fonts/fraunces-latin-500-normal.woff2',
  variable: '--font-fraunces',
  weight: '500',
  display: 'swap',
  preload: false,
});

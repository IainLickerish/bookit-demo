import localFont from 'next/font/local';

export const figtree = localFont({
  src: [
    { path: './fonts/figtree-latin-400-normal.woff2', weight: '400', style: 'normal' },
    { path: './fonts/figtree-latin-500-normal.woff2', weight: '500', style: 'normal' },
    { path: './fonts/figtree-latin-600-normal.woff2', weight: '600', style: 'normal' },
  ],
  variable: '--font-figtree',
  display: 'swap',
});
export const fraunces = localFont({
  src: './fonts/fraunces-latin-500-normal.woff2',
  weight: '500',
  style: 'normal',
  variable: '--font-fraunces',
  display: 'swap',
});

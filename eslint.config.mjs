import nextCoreWebVitals from 'eslint-config-next/core-web-vitals';
import nextTypescript from 'eslint-config-next/typescript';

const clockMessage =
  'Read the time from the clock (src/lib/clock.ts) so test-clock builds follow the shared virtual clock.';

const config = [
  {
    ignores: [
      'node_modules/**',
      '.next/**',
      '.next-*/**',
      'next-env.d.ts',
      'drizzle/**',
      'test-results/**',
      'playwright-report/**',
    ],
  },
  ...nextCoreWebVitals,
  ...nextTypescript,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/await-thenable': 'error',
      'no-restricted-syntax': [
        'error',
        {
          selector: "CallExpression[callee.object.name='Date'][callee.property.name='now']",
          message: clockMessage,
        },
        {
          selector: "NewExpression[callee.name='Date'][arguments.length=0]",
          message: clockMessage,
        },
        {
          selector: "CallExpression[callee.property.name='defaultNow']",
          message: 'Write timestamps from the application clock, never SQL now().',
        },
        {
          selector: 'TemplateElement[value.raw=/\\bnow\\s*\\(\\s*\\)/i]',
          message: 'Write timestamps from the application clock, never SQL now().',
        },
      ],
    },
  },
  {
    files: ['src/lib/clock.ts'],
    rules: { 'no-restricted-syntax': 'off' },
  },
];

export default config;

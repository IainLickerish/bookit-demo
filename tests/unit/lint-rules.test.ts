import path from 'node:path';
import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

const root = path.resolve(import.meta.dirname, '../..');

const eslint = new ESLint({
  cwd: root,
  overrideConfig: [
    {
      files: ['**/*.ts'],
      languageOptions: { parserOptions: { projectService: false } },
      rules: {
        '@typescript-eslint/no-floating-promises': 'off',
        '@typescript-eslint/no-misused-promises': 'off',
        '@typescript-eslint/await-thenable': 'off',
        '@typescript-eslint/no-unused-vars': 'off',
      },
    },
  ],
});

async function clockViolations(code: string, file: string): Promise<string[]> {
  const [result] = await eslint.lintText(code, { filePath: path.join(root, file) });
  const messages = (result?.messages ?? []).filter((m) => m.ruleId === 'no-restricted-syntax');
  for (const m of messages) {
    console.log(`${file}:${m.line}:${m.column} ${m.ruleId} ${m.message}`);
  }
  return messages.map((m) => m.message);
}

describe('clock lint rule (plan 13.10 determinism)', () => {
  it.each([
    ['Date.now()', 'export const t = Date.now();'],
    ['argument-less new Date()', 'export const t = new Date();'],
    ['defaultNow()', 'declare const c: { defaultNow(): void }; c.defaultNow();'],
    ['SQL now()', 'declare function sql(s: TemplateStringsArray): void; sql`update booking set updated_at = now()`;'],
  ])(
    'rejects %s outside the clock module',
    async (_name, code) => {
      expect(await clockViolations(code, 'src/server/example.ts')).toHaveLength(1);
    },
    60_000,
  );

  it('allows the clock module to read the system time', async () => {
    expect(await clockViolations('export const t = new Date();', 'src/lib/clock.ts')).toEqual([]);
  }, 60_000);

  it('allows dates built from a value', async () => {
    expect(
      await clockViolations("export const t = new Date('2026-10-20T11:00:00Z');", 'src/server/example.ts'),
    ).toEqual([]);
  }, 60_000);
});

import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from '@/server/auth/password';

describe('password hashing for patient sign-in (REQ-18.1-01)', () => {
  it('stores a salted scrypt hash, never the password', async () => {
    const first = await hashPassword('a-long-test-password');
    const second = await hashPassword('a-long-test-password');
    expect(first).toMatch(/^scrypt\$32768\$8\$1\$[\w-]+\$[\w-]+$/);
    expect(first).not.toContain('a-long-test-password');
    expect(first).not.toBe(second);
  });

  it('verifies the right password and rejects others', async () => {
    const stored = await hashPassword('a-long-test-password');
    expect(await verifyPassword('a-long-test-password', stored)).toBe(true);
    expect(await verifyPassword('a-long-test-passwore', stored)).toBe(false);
    expect(await verifyPassword('', stored)).toBe(false);
  });

  it('rejects malformed stored hashes without throwing', async () => {
    for (const stored of ['', 'plain', 'scrypt$x$8$1$aa$bb', 'bcrypt$1$2$3$4$5']) {
      expect(await verifyPassword('a-long-test-password', stored)).toBe(false);
    }
  });

  it('refuses passwords shorter than 12 characters', async () => {
    await expect(hashPassword('short')).rejects.toThrow(RangeError);
  });
});

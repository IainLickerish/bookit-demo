import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

// scrypt with N=2^15, r=8, p=1 uses 32 MiB per hash.
const COST = 2 ** 15;
const BLOCK_SIZE = 8;
const PARALLELISM = 1;
const KEY_LENGTH = 64;
const SALT_LENGTH = 16;
const MAX_MEMORY = 64 * 1024 * 1024;
const PREFIX = 'scrypt';

export const MIN_PASSWORD_LENGTH = 12;
export const MAX_PASSWORD_LENGTH = 256;

function deriveKey(
  password: string,
  salt: Buffer,
  cost: number,
  blockSize: number,
  parallelism: number,
  keyLength: number,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(
      password.normalize('NFKC'),
      salt,
      keyLength,
      { N: cost, r: blockSize, p: parallelism, maxmem: MAX_MEMORY },
      (error, key) => (error ? reject(error) : resolve(key)),
    );
  });
}

export async function hashPassword(password: string): Promise<string> {
  if (password.length < MIN_PASSWORD_LENGTH || password.length > MAX_PASSWORD_LENGTH) {
    throw new RangeError(`Passwords must be ${MIN_PASSWORD_LENGTH} to ${MAX_PASSWORD_LENGTH} characters.`);
  }
  const salt = randomBytes(SALT_LENGTH);
  const key = await deriveKey(password, salt, COST, BLOCK_SIZE, PARALLELISM, KEY_LENGTH);
  return [PREFIX, COST, BLOCK_SIZE, PARALLELISM, salt.toString('base64url'), key.toString('base64url')].join('$');
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== PREFIX) {
    return false;
  }
  const [cost, blockSize, parallelism] = [Number(parts[1]), Number(parts[2]), Number(parts[3])];
  if (![cost, blockSize, parallelism].every((n) => Number.isInteger(n) && n > 0)) {
    return false;
  }
  const salt = Buffer.from(parts[4] ?? '', 'base64url');
  const expected = Buffer.from(parts[5] ?? '', 'base64url');
  if (salt.length === 0 || expected.length === 0 || password.length > MAX_PASSWORD_LENGTH) {
    return false;
  }
  const actual = await deriveKey(password, salt, cost, blockSize, parallelism, expected.length);
  return timingSafeEqual(actual, expected);
}

let dummyHash: Promise<string> | undefined;

/**
 * Spends the same work as a real check when no account matches, so response
 * times do not reveal which email addresses have accounts.
 */
export async function verifyAgainstDummy(password: string): Promise<false> {
  dummyHash ??= hashPassword(randomBytes(24).toString('base64url'));
  await verifyPassword(password.slice(0, MAX_PASSWORD_LENGTH), await dummyHash);
  return false;
}

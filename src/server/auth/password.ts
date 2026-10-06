import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

/**
 * Passwords are stored as salted scrypt hashes. The cost parameters travel
 * with each hash, so they can be raised later without breaking old ones.
 */
const COST = { N: 2 ** 15, r: 8, p: 1 };
const KEY_LENGTH = 32;
const MAX_MEMORY = 128 * 1024 * 1024;

function derive(password: string, salt: Buffer, cost: typeof COST): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scrypt(password.normalize('NFKC'), salt, KEY_LENGTH, { ...cost, maxmem: MAX_MEMORY }, (err, key) => (err ? reject(err) : resolve(key))),
  );
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await derive(password, salt, COST);
  return ['scrypt', COST.N, COST.r, COST.p, salt.toString('base64url'), key.toString('base64url')].join('$');
}

export async function verifyPassword(password: string, stored: string | null): Promise<boolean> {
  const [scheme, N, r, p, salt, key] = (stored ?? '').split('$');
  if (scheme !== 'scrypt' || !salt || !key) {
    // Spend the same time as a real check so a missing account is not detectable by timing.
    await derive(password, Buffer.alloc(16), COST);
    return false;
  }
  const expected = Buffer.from(key, 'base64url');
  const actual = await derive(password, Buffer.from(salt, 'base64url'), { N: Number(N), r: Number(r), p: Number(p) });
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

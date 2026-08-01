import { randomBytes, scrypt as scryptCb, timingSafeEqual } from 'crypto';

const KEY_LEN = 64;
// N=16384 (2^14), r=8, p=1 — scrypt's own recommended interactive-use
// baseline; costs roughly 16 MB and tens of milliseconds per attempt,
// which is what a login form (not a bulk KDF) needs.
const SCRYPT_OPTS = { N: 16384, r: 8, p: 1 } as const;

function scryptAsync(password: string, salt: Buffer, keylen: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCb(password, salt, keylen, SCRYPT_OPTS, (err, derivedKey) => {
      if (err) reject(err);
      else resolve(derivedKey);
    });
  });
}

export interface AuthRecord {
  salt: string; // hex
  hash: string; // hex
}

export async function hashPassphrase(passphrase: string): Promise<AuthRecord> {
  const salt = randomBytes(16);
  const derived = await scryptAsync(passphrase, salt, KEY_LEN);
  return { salt: salt.toString('hex'), hash: derived.toString('hex') };
}

export async function verifyPassphrase(passphrase: string, record: AuthRecord): Promise<boolean> {
  const salt = Buffer.from(record.salt, 'hex');
  const expected = Buffer.from(record.hash, 'hex');
  const derived = await scryptAsync(passphrase, salt, expected.length);
  if (derived.length !== expected.length) return false;
  return timingSafeEqual(derived, expected);
}

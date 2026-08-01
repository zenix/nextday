import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hashPassphrase, verifyPassphrase } from './passphrase.js';

test('a correct passphrase verifies against its own hash', async () => {
  const record = await hashPassphrase('correct horse battery staple');
  assert.equal(await verifyPassphrase('correct horse battery staple', record), true);
});

test('an incorrect passphrase is rejected', async () => {
  const record = await hashPassphrase('correct horse battery staple');
  assert.equal(await verifyPassphrase('wrong passphrase', record), false);
});

test('hashing the same passphrase twice yields different salts and hashes', async () => {
  const a = await hashPassphrase('same passphrase');
  const b = await hashPassphrase('same passphrase');
  assert.notEqual(a.salt, b.salt);
  assert.notEqual(a.hash, b.hash);
  // ... but both still verify correctly
  assert.equal(await verifyPassphrase('same passphrase', a), true);
  assert.equal(await verifyPassphrase('same passphrase', b), true);
});

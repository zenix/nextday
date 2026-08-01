import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assertSafeUrl, UnsafeUrlError } from './safeFetch.js';

test('rejects http:// by default', async () => {
  await assert.rejects(() => assertSafeUrl('http://example.com/feed.ics'), UnsafeUrlError);
});

test('allows http:// when explicitly opted in', async () => {
  // example.com resolves to a public address, not a blocked range.
  await assertSafeUrl('http://example.com/', { allowHttp: true });
});

test('rejects a loopback IP literal', async () => {
  await assert.rejects(() => assertSafeUrl('https://127.0.0.1/feed.ics'), UnsafeUrlError);
});

test('rejects an IPv6 loopback literal', async () => {
  await assert.rejects(() => assertSafeUrl('https://[::1]/feed.ics'), UnsafeUrlError);
});

test('rejects RFC1918 private ranges', async () => {
  await assert.rejects(() => assertSafeUrl('https://10.0.0.5/'), UnsafeUrlError);
  await assert.rejects(() => assertSafeUrl('https://172.16.0.5/'), UnsafeUrlError);
  await assert.rejects(() => assertSafeUrl('https://192.168.1.5/'), UnsafeUrlError);
});

test('rejects the link-local / cloud metadata address', async () => {
  await assert.rejects(() => assertSafeUrl('https://169.254.169.254/latest/meta-data/'), UnsafeUrlError);
});

test('rejects "localhost" by name', async () => {
  await assert.rejects(() => assertSafeUrl('https://localhost/'), UnsafeUrlError);
});

test('rejects a URL with embedded credentials', async () => {
  await assert.rejects(() => assertSafeUrl('https://user:pass@example.com/'), UnsafeUrlError);
});

test('rejects an unresolvable hostname', async () => {
  await assert.rejects(() => assertSafeUrl('https://this-should-not-resolve.invalid/'), UnsafeUrlError);
});

test('rejects a malformed URL', async () => {
  await assert.rejects(() => assertSafeUrl('not a url'), UnsafeUrlError);
});

test('accepts a normal public https URL', async () => {
  const url = await assertSafeUrl('https://example.com/feed.ics');
  assert.equal(url.hostname, 'example.com');
});

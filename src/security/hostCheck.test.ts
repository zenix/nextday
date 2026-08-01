import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractHostname } from './hostCheck.js';

test('extractHostname strips a port', () => {
  assert.equal(extractHostname('example.com:3000'), 'example.com');
});

test('extractHostname lowercases', () => {
  assert.equal(extractHostname('Example.COM'), 'example.com');
});

test('extractHostname handles a bracketed IPv6 host with a port', () => {
  assert.equal(extractHostname('[::1]:3000'), '::1');
});

test('extractHostname handles a bracketed IPv6 host with no port', () => {
  assert.equal(extractHostname('[::1]'), '::1');
});

test('extractHostname handles a bare hostname with no port', () => {
  assert.equal(extractHostname('localhost'), 'localhost');
});

test('extractHostname returns null for a missing header', () => {
  assert.equal(extractHostname(undefined), null);
});

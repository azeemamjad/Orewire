#!/usr/bin/env node
/** Security unit checks for Relay module */
const assert = require('assert');
const {
  assertValidWorkerId,
  assertAllowedNavigationUrl,
  assertValidViewTokenParam,
} = require('../relay/security');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log('✓', name);
    passed++;
  } catch (e) {
    console.log('✗', name, '—', e.message);
    failed++;
  }
}

test('valid worker ids', () => {
  assertValidWorkerId('relay-proxy-1');
  assertValidWorkerId('relay-proxy-42');
  assertValidWorkerId('relay-direct-1');
});

test('reject invalid worker ids', () => {
  assert.throws(() => assertValidWorkerId('../etc/passwd'));
  assert.throws(() => assertValidWorkerId('relay-evil-1'));
  assert.throws(() => assertValidWorkerId(''));
});

test('block localhost navigation', () => {
  assert.throws(() => assertAllowedNavigationUrl('http://127.0.0.1/admin'));
  assert.throws(() => assertAllowedNavigationUrl('http://localhost:3000'));
});

test('block private IP navigation', () => {
  assert.throws(() => assertAllowedNavigationUrl('http://192.168.1.1'));
  assert.throws(() => assertAllowedNavigationUrl('http://10.0.0.5'));
});

test('block file protocol', () => {
  assert.throws(() => assertAllowedNavigationUrl('file:///etc/passwd'));
});

test('allow public https', () => {
  const u = assertAllowedNavigationUrl('https://example.com/path');
  assert.ok(u.includes('example.com'));
});

test('token param format', () => {
  assert.ok(assertValidViewTokenParam('abc.def'));
  assert.ok(!assertValidViewTokenParam('<script>'));
  assert.ok(!assertValidViewTokenParam('a'.repeat(600)));
});

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);

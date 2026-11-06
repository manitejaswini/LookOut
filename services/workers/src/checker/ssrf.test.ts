import test from 'node:test';
import assert from 'node:assert/strict';
import { BlockedUrlError, guardedLookup, isPublicAddress, validateUrl } from './ssrf.ts';

test('public IPv4 addresses are allowed', () => {
  for (const ip of ['8.8.8.8', '1.1.1.1', '93.184.216.34', '151.101.1.69', '172.15.255.255', '172.32.0.1', '100.63.255.255', '100.128.0.1', '11.0.0.1', '9.255.255.255']) {
    assert.equal(isPublicAddress(ip), true, ip);
  }
});

test('private, loopback, link-local, metadata and special IPv4 addresses are blocked', () => {
  for (const ip of [
    '0.0.0.0', '0.1.2.3', '10.0.0.1', '10.255.255.255', '127.0.0.1', '127.255.255.254', '169.254.169.254', '169.254.0.1',
    '172.16.0.1', '172.31.255.255', '192.168.0.1', '192.168.255.255', '100.64.0.1', '100.127.255.255', '192.0.0.1', '192.0.2.5',
    '198.18.0.1', '198.19.255.255', '198.51.100.1', '203.0.113.9', '224.0.0.1', '239.255.255.255', '240.0.0.1', '255.255.255.255',
  ]) {
    assert.equal(isPublicAddress(ip), false, ip);
  }
});

test('public IPv6 addresses are allowed', () => {
  for (const ip of ['2606:4700:4700::1111', '2001:4860:4860::8888', '2a00:1450:4001:81b::200e']) assert.equal(isPublicAddress(ip), true, ip);
});

test('loopback, unspecified, unique-local, link-local, multicast and documentation IPv6 are blocked', () => {
  for (const ip of ['::', '::1', '0:0:0:0:0:0:0:1', 'fc00::1', 'fd12:3456:789a::1', 'fe80::1', 'febf::1', 'ff02::1', '2001:db8::1', '100::1']) {
    assert.equal(isPublicAddress(ip), false, ip);
  }
});

test('IPv4 hidden inside IPv6 is judged by the IPv4 address it carries (the classic bypass)', () => {
  for (const ip of ['::ffff:127.0.0.1', '::ffff:7f00:1', '::ffff:10.0.0.1', '::ffff:a00:1', '::ffff:169.254.169.254', '::ffff:c0a8:1', '::127.0.0.1', '64:ff9b::7f00:1', '2002:7f00:1::1', '2002:a9fe:a9fe::1']) {
    assert.equal(isPublicAddress(ip), false, ip);
  }
  for (const ip of ['::ffff:8.8.8.8', '::ffff:808:808', '64:ff9b::808:808', '2002:808:808::1']) {
    assert.equal(isPublicAddress(ip), true, ip);
  }
});

test('anything that is not a valid IP address is treated as unsafe', () => {
  for (const ip of ['', 'localhost', 'example.com', '999.1.1.1', '1.2.3', '1.2.3.4.5', ':::', '1::2::3', 'g::1', '1.2.3.4/8']) {
    assert.equal(isPublicAddress(ip), false, JSON.stringify(ip));
  }
});

test('bracketed IPv6 and zone ids are handled', () => {
  assert.equal(isPublicAddress('[::1]'), false);
  assert.equal(isPublicAddress('fe80::1%eth0'), false);
  assert.equal(isPublicAddress('[2606:4700:4700::1111]'), true);
});

test('validateUrl accepts a normal https and http URL', () => {
  assert.equal(validateUrl('https://example.com/a?b=1').hostname, 'example.com');
  assert.equal(validateUrl('http://example.com:80/').hostname, 'example.com');
  assert.equal(validateUrl('https://example.com:443/').hostname, 'example.com');
});

test('validateUrl rejects other schemes, credentials, odd ports and non-public IP literals', () => {
  const bad = [
    'ftp://example.com/', 'file:///etc/passwd', 'gopher://example.com/', 'javascript:alert(1)', 'data:text/html,hi',
    'https://user:pw@example.com/', 'https://user@example.com/',
    'http://example.com:8080/', 'https://example.com:22/', 'http://example.com:6379/',
    'http://127.0.0.1/', 'http://[::1]/', 'http://169.254.169.254/latest/meta-data/',
    'http://10.0.0.1/', 'http://192.168.1.1/', 'http://[::ffff:7f00:1]/',
    // other spellings of 127.0.0.1 that the URL parser normalises
    'http://2130706433/', 'http://0x7f000001/', 'http://0177.0.0.1/', 'http://127.1/',
    'not a url', '',
  ];
  for (const u of bad) assert.throws(() => validateUrl(u), BlockedUrlError, u);
});

test('guardedLookup refuses a name that resolves to loopback (the real resolver, no network needed)', async () => {
  const result = await new Promise<{ err: Error | null }>((resolve) => guardedLookup('localhost', {}, (err) => resolve({ err })));
  assert.ok(result.err instanceof BlockedUrlError, 'localhost must be blocked');
  assert.match(result.err.message, /non-public/);
});

test('guardedLookup returns the list form when asked for all addresses, and refuses a mixed answer', async () => {
  // an IP literal resolves to itself without network access
  const ok = await new Promise<unknown>((resolve) => guardedLookup('8.8.8.8', { all: true }, (e, a) => resolve(e ?? a)));
  assert.ok(Array.isArray(ok));
  assert.equal((ok as { address: string }[])[0].address, '8.8.8.8');
  const blocked = await new Promise<unknown>((resolve) => guardedLookup('127.0.0.1', { all: true }, (e) => resolve(e)));
  assert.ok(blocked instanceof BlockedUrlError);
});

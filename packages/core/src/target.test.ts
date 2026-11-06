import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeTarget, targetHash } from './target.ts';

test('domains: scheme, port, path, case and trailing dot are dropped', () => {
  const want = 'claim-arbitrum-airdrop.xyz';
  for (const v of [
    'claim-arbitrum-airdrop.xyz',
    'CLAIM-Arbitrum-Airdrop.XYZ',
    'https://claim-arbitrum-airdrop.xyz/mint?x=1#top',
    'http://user:pw@claim-arbitrum-airdrop.xyz:8443/',
    'claim-arbitrum-airdrop.xyz.',
    '  claim-arbitrum-airdrop.xyz  ',
  ]) assert.equal(normalizeTarget('domain', v), want, v);
});

test('domains: www is kept (different host), IDN becomes punycode', () => {
  assert.equal(normalizeTarget('domain', 'www.example.com'), 'www.example.com');
  assert.equal(normalizeTarget('domain', 'bücher.example'), 'xn--bcher-kva.example');
});

test('domains: junk is rejected', () => {
  for (const v of ['', '   ', 'localhost', 'http://']) assert.throws(() => normalizeTarget('domain', v), v);
});

test('addresses: lowercased, strict shape', () => {
  const a = '0x5Fd9a1E4b7c3920B6a8E1d04C7f23b9a6E5d1c08';
  assert.equal(normalizeTarget('address', a), a.toLowerCase());
  assert.equal(normalizeTarget('contract', a), a.toLowerCase());
  for (const v of ['0x123', a.slice(2), `${a}00`, '0xZZd9a1e4b7c3920b6a8e1d04c7f23b9a6e5d1c08'])
    assert.throws(() => normalizeTarget('address', v), v);
});

test('targetHash: stable, 32 bytes, equivalent inputs collide, different inputs do not', () => {
  const h = targetHash('domain', 'claim-arbitrum-airdrop.xyz');
  assert.match(h, /^0x[0-9a-f]{64}$/);
  assert.equal(targetHash('domain', 'HTTPS://Claim-Arbitrum-Airdrop.xyz/path'), h);
  assert.notEqual(targetHash('domain', 'claim-arbitrum-airdrop.com'), h);
});

test('targetHash: an address hashes the same as a contract, and differs from a domain', () => {
  const a = '0x5fd9a1e4b7c3920b6a8e1d04c7f23b9a6e5d1c08';
  assert.equal(targetHash('address', a), targetHash('contract', a.toUpperCase().replace('0X', '0x')));
  assert.notEqual(targetHash('address', a), targetHash('domain', 'example.com'));
});

test('targetHash: pinned vectors (changing these breaks every indexer, so bump the schema version)', () => {
  assert.equal(targetHash('domain', 'example.com'), PINNED.domain);
  assert.equal(targetHash('address', '0x5fd9a1e4b7c3920b6a8e1d04c7f23b9a6e5d1c08'), PINNED.evm);
});

// keccak256("domain:example.com") and keccak256("evm:0x5fd9...1c08"). The primitive was checked
// against the known keccak256("") vector so this is Ethereum Keccak, not NIST SHA-3.
const PINNED = {
  domain: '0x2f82eafa4c5209aa62b23f7c721d9cbb14653247a84ba849ad94b042d00483e7',
  evm: '0x9d94ab9948295ec07f20017801155c76dbf5268c25160de5e405ecf4ff9dc29f',
};

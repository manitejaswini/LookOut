import test from 'node:test';
import assert from 'node:assert/strict';
import { keccak_256 } from '@noble/hashes/sha3.js';
import { checkContract, DrainerList, parseDrainerList, rpcCodeSource, type CodeSource } from './contract.ts';
import { evidenceBytes, evidenceHash, verifyProof } from './evidence.ts';

const toHex = (b: Uint8Array) => `0x${Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')}`;
const ADDR = '0x5fd9a1e4b7c3920b6a8e1d04c7f23b9a6e5d1c08';
const now = () => new Date('2026-11-06T12:00:00.000Z');

// invented bytecode used ONLY as a test fixture. It is not a real contract and not a real drainer.
const FIXTURE_CODE = '0x6080604052348015600f57600080fd5b5060ff80601d6000396000f3fe';
const FIXTURE_HASH = toHex(keccak_256(Uint8Array.from(FIXTURE_CODE.slice(2).match(/../g)!.map((h) => parseInt(h, 16)))));

const code = (hex: string, chainId = 11155111): CodeSource => ({ async chainId() { return chainId; }, async getCode() { return hex; } });
const list = (...entries: { codeHash: string; label: string; source: string }[]) => new DrainerList(entries);

test('bytecode whose hash is on the list is a FINDING with evidence anyone can re-check', async () => {
  const drainers = list({ codeHash: FIXTURE_HASH, label: 'test-fixture-drainer', source: 'a test fixture, not a real report' });
  const { finding, notes } = await checkContract(ADDR.toUpperCase().replace('0X', '0x'), { code: code(FIXTURE_CODE), drainers, now });
  assert.ok(finding);
  assert.equal(finding.kind, 'known-drainer-bytecode');
  assert.equal(finding.targetKind, 'contract');
  assert.equal(finding.value, ADDR, 'the address is normalised');
  assert.equal(finding.evidence.codeHash, FIXTURE_HASH);
  assert.equal(finding.evidence.chainId, 11155111);
  assert.equal(finding.evidence.codeBytes, (FIXTURE_CODE.length - 2) / 2);
  assert.equal(finding.evidence.listedAs, 'test-fixture-drainer');
  assert.match(finding.reason, /known drainer "test-fixture-drainer"/);
  assert.ok(notes.some((n) => n.startsWith('FOUND')));
  assert.equal(verifyProof(evidenceBytes(finding.evidence), evidenceHash(finding.evidence)), true);
});

test('code that is not on the list is no finding, and the note says it is not a clearance', async () => {
  const { finding, notes } = await checkContract(ADDR, { code: code(FIXTURE_CODE), drainers: list(), now });
  assert.equal(finding, null);
  assert.ok(notes.some((n) => /not a clearance/.test(n)));
});

test('an address with no code is not a finding', async () => {
  const { finding, notes } = await checkContract(ADDR, { code: code('0x'), drainers: list({ codeHash: FIXTURE_HASH, label: 'x', source: 's' }), now });
  assert.equal(finding, null);
  assert.ok(notes.some((n) => /no code/.test(n)));
});

test('a malformed address or malformed bytecode is rejected, never guessed at', async () => {
  const drainers = list();
  await assert.rejects(checkContract('0x123', { code: code(FIXTURE_CODE), drainers, now }), /invalid contract/);
  await assert.rejects(checkContract(ADDR, { code: code('0xabc'), drainers, now }), /malformed bytecode/);
  await assert.rejects(checkContract(ADDR, { code: code('0xzz'), drainers, now }), /malformed bytecode/);
});

test('similar-looking code does not match: the match is exact, with no guesswork', async () => {
  const drainers = list({ codeHash: FIXTURE_HASH, label: 'fixture', source: 's' });
  const oneByteOff = `${FIXTURE_CODE.slice(0, -2)}ff`;
  assert.equal((await checkContract(ADDR, { code: code(oneByteOff), drainers, now })).finding, null);
});

/* ---------- the list ---------- */

test('every list entry must carry a source, a label and a well-formed hash', () => {
  assert.throws(() => list({ codeHash: FIXTURE_HASH, label: 'x', source: '' }), /no source/);
  assert.throws(() => list({ codeHash: FIXTURE_HASH, label: '', source: 's' }), /no label/);
  assert.throws(() => list({ codeHash: '0xABC', label: 'x', source: 's' }), /bad codeHash/);
  assert.throws(() => list({ codeHash: FIXTURE_HASH.toUpperCase().replace('0X', '0x'), label: 'x', source: 's' }), /bad codeHash/);
  assert.throws(() => list({ codeHash: FIXTURE_HASH, label: 'a', source: 's' }, { codeHash: FIXTURE_HASH, label: 'b', source: 's' }), /duplicate/);
});

test('parseDrainerList reads the committed file shape, which ships empty on purpose', () => {
  assert.equal(parseDrainerList({ entries: [] }).size, 0);
  assert.throws(() => parseDrainerList({}), /expected/);
  assert.throws(() => parseDrainerList(null), /expected/);
});

/* ---------- the JSON-RPC code source ---------- */

test('rpcCodeSource speaks eth_chainId and eth_getCode and surfaces node errors', async () => {
  const seen: { method: string; params: unknown[] }[] = [];
  const fakeFetch = (async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body)) as { id: number; method: string; params: unknown[] };
    seen.push({ method: body.method, params: body.params });
    if (body.method === 'eth_chainId') return new Response(JSON.stringify({ jsonrpc: '2.0', id: body.id, result: '0xaa36a7' }));
    if (body.method === 'eth_getCode') return new Response(JSON.stringify({ jsonrpc: '2.0', id: body.id, result: FIXTURE_CODE }));
    return new Response(JSON.stringify({ jsonrpc: '2.0', id: body.id, error: { message: 'nope' } }));
  }) as unknown as typeof fetch;

  const src = rpcCodeSource('https://rpc.example', fakeFetch);
  assert.equal(await src.chainId(), 11155111);
  assert.equal(await src.getCode(ADDR), FIXTURE_CODE);
  assert.deepEqual(seen, [{ method: 'eth_chainId', params: [] }, { method: 'eth_getCode', params: [ADDR, 'latest'] }]);

  const failing = rpcCodeSource('https://rpc.example', (async () => new Response('{}', { status: 502 })) as unknown as typeof fetch);
  await assert.rejects(failing.chainId(), /HTTP 502/);
  const rpcError = rpcCodeSource('https://rpc.example', (async () => new Response(JSON.stringify({ error: { message: 'rate limited' } }))) as unknown as typeof fetch);
  await assert.rejects(rpcError.getCode(ADDR), /rate limited/);
});

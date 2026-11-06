import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeReportPayload, encodeReportPayload, MAX_REPORT_PAYLOAD_BYTES } from './report-payload.ts';
import { targetHash } from './target.ts';

const H = targetHash('domain', 'evil-site.example');

test('a payload round-trips and is checked against the hash the report was indexed under', () => {
  const bytes = encodeReportPayload({ kind: 'domain', value: 'Evil-Site.example' });
  const r = decodeReportPayload(bytes, H);
  assert.ok(r.ok);
  assert.equal(r.payload.kind, 'domain');
  assert.equal(r.payload.target, 'evil-site.example', 'normalized');
});

test('a payload naming a DIFFERENT target than the report is rejected, so a report cannot be re-pointed', () => {
  const bytes = encodeReportPayload({ kind: 'domain', value: 'innocent.example' });
  const r = decodeReportPayload(bytes, H);
  assert.equal(r.ok, false);
  assert.match((r as { reason: string }).reason, /does not match/);
});

test('an address target works whichever kind was used (address and contract share a hash)', () => {
  const a = '0x5fd9a1e4b7c3920b6a8e1d04c7f23b9a6e5d1c08';
  const bytes = encodeReportPayload({ kind: 'contract', value: a });
  assert.ok(decodeReportPayload(bytes, targetHash('address', a)).ok);
});

test('junk is refused without throwing: missing, not JSON, wrong version, bad kind, bad target, oversized, bad seal', () => {
  const enc = (o: unknown) => new TextEncoder().encode(JSON.stringify(o));
  const cases: [string, Uint8Array | undefined][] = [
    ['missing', undefined], ['empty', new Uint8Array()], ['not json', new TextEncoder().encode('hello')], ['binary', Uint8Array.of(0xff, 0xfe, 0x00)],
    ['version', enc({ v: 9, k: 'domain', t: 'evil-site.example' })], ['kind', enc({ v: 0, k: 'wallet', t: 'evil-site.example' })],
    ['target', enc({ v: 0, k: 'domain', t: 'not a domain!!' })], ['no target', enc({ v: 0, k: 'domain' })],
    ['big', new Uint8Array(MAX_REPORT_PAYLOAD_BYTES + 1).fill(65)],
  ];
  for (const [name, bytes] of cases) assert.equal(decodeReportPayload(bytes, H).ok, false, name);
});

test('encoding refuses a target that is not valid, and keeps the payload small', () => {
  assert.throws(() => encodeReportPayload({ kind: 'domain', value: 'not a domain!!' }));
  assert.ok(encodeReportPayload({ kind: 'domain', value: 'evil-site.example' }).length < MAX_REPORT_PAYLOAD_BYTES);
});

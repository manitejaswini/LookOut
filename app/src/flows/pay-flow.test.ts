import test from 'node:test';
import assert from 'node:assert/strict';
import type { CheckResult } from '@lookout/core';
import { parsePayment, PayError, reviewPayment, REVIEW_MAX_AGE_MS, sendPayment, tierFor, type PaymentRecord, type Review, type SendPorts } from './pay-flow.ts';

const TO = '0x5fd9a1e4b7c3920b6a8e1d04c7f23b9a6e5d1c08';
const result = (verdict: CheckResult['verdict'], over: Partial<CheckResult> = {}): CheckResult => ({
  verdict, disputed: false, reasons: [], snapshotId: 'snap-1', verified: true, headline: 'x', typeScores: {}, strongTypes: 0, ...over,
});
const pay = () => { const p = parsePayment({ recipient: TO, amountEth: '0.001' }); assert.ok(p.ok); return p.payment; };

test('parsePayment accepts a normal payment and lowercases the address', () => {
  const p = parsePayment({ recipient: ' ' + TO.toUpperCase().replace('0X', '0x') + ' ', amountEth: ' 0.0015 ' });
  assert.ok(p.ok);
  assert.equal(p.payment.recipient, TO);
  assert.equal(p.payment.amountWei, 1_500_000_000_000_000n);
});

test('bad addresses and amounts are refused with a reason a person can act on', () => {
  for (const recipient of ['', '0x123', 'vitalik.eth', TO + '00', 'g'.repeat(42)]) assert.equal(parsePayment({ recipient, amountEth: '1' }).ok, false, recipient);
  assert.match((parsePayment({ recipient: '0x' + '0'.repeat(40), amountEth: '1' }) as { error: string }).error, /zero address/);
  for (const amountEth of ['', '0', '0.0', '-1', '1e3', 'abc', '1.0000000000000000001', '.5']) assert.equal(parsePayment({ recipient: TO, amountEth }).ok, false, amountEth);
});

test('the confirmation each verdict needs', () => {
  assert.equal(tierFor(result('unknown')), 'none');
  assert.equal(tierFor(result('warn')), 'care');
  assert.equal(tierFor(result('block')), 'override');
  assert.equal(tierFor(null), 'override', 'a check that failed is never read as fine');
});

test('reviewPayment checks the address as an address, and a failing lookup becomes an override-level review', async () => {
  const seen: unknown[] = [];
  const ok = await reviewPayment({ checkTarget: async (v, k) => (seen.push([v, k]), result('block')), now: () => 5 }, pay());
  assert.deepEqual(seen, [[TO, 'address']]);
  assert.equal(ok.tier, 'override');
  assert.equal(ok.at, 5);

  const bad = await reviewPayment({ checkTarget: async () => { throw new Error('PIR servers unreachable'); }, now: () => 6 }, pay());
  assert.equal(bad.check, null);
  assert.equal(bad.tier, 'override');
  assert.match(bad.checkError!, /unreachable/);
});

function sendPorts(over: Partial<SendPorts> = {}) {
  const log: string[] = [];
  const records: PaymentRecord[] = [];
  let t = 1_000_000;
  const ports: SendPorts = {
    now: () => t,
    switchChain: async () => void log.push('chain'),
    sendEth: async (to, wei) => (log.push(`send:${to}:${wei}`), { hash: '0xabc' }),
    record: (e) => void records.push(e),
    ...over,
  };
  return { ports, log, records, advance: (ms: number) => { t += ms; } };
}
const review = (verdict: CheckResult['verdict'] | null, at = 1_000_000): Review => {
  const check = verdict ? result(verdict) : null;
  return { payment: pay(), check, tier: tierFor(check), at };
};

test('nothing found: one plain click sends', async () => {
  const s = sendPorts();
  const out = await sendPayment(s.ports, review('unknown'), 'none');
  assert.equal(out.hash, '0xabc');
  assert.deepEqual(s.log, ['chain', `send:${TO}:1000000000000000`]);
  assert.equal(out.record.overrode, false);
});

test('a warning needs the person to confirm they read it, and a plain click is refused', async () => {
  const s = sendPorts();
  await assert.rejects(sendPayment(s.ports, review('warn'), 'none'), (e) => e instanceof PayError && e.code === 'needs-confirmation');
  assert.deepEqual(s.log, [], 'nothing was sent');
  assert.deepEqual(s.records, [], 'and nothing was recorded, because nothing was attempted');
  const out = await sendPayment(s.ports, review('warn'), 'care');
  assert.equal(out.record.overrode, true);
});

test('SEND ANYWAY: a flagged address can be paid, but only with the explicit override, and it is recorded', async () => {
  const s = sendPorts();
  for (const weak of ['none', 'care'] as const) {
    await assert.rejects(sendPayment(s.ports, review('block'), weak), (e) => e instanceof PayError && e.code === 'needs-confirmation', weak);
  }
  assert.deepEqual(s.log, []);
  const out = await sendPayment(s.ports, review('block'), 'override');
  assert.equal(out.record.verdict, 'block');
  assert.equal(out.record.tier, 'override');
  assert.equal(out.record.overrode, true);
  assert.equal(s.records.length, 2, 'intent recorded first, then the result with the hash');
  assert.equal(s.records[0].txHash, undefined);
  assert.equal(s.records[1].txHash, '0xabc');
});

test('the override is on record even when the wallet then refuses', async () => {
  const s = sendPorts({ sendEth: async () => { throw new Error('User rejected the request'); } });
  await assert.rejects(sendPayment(s.ports, review('block'), 'override'), (e) => e instanceof PayError && e.code === 'send-failed' && /rejected/.test(e.message));
  assert.equal(s.records.length, 1);
  assert.equal(s.records[0].verdict, 'block');
});

test('a check that failed also needs the explicit override, and is recorded as check-failed', async () => {
  const s = sendPorts();
  await assert.rejects(sendPayment(s.ports, review(null), 'care'), (e) => e instanceof PayError && e.code === 'needs-confirmation');
  const out = await sendPayment(s.ports, review(null), 'override');
  assert.equal(out.record.verdict, 'check-failed');
});

test('a stronger confirmation than needed is fine', async () => {
  const s = sendPorts();
  await sendPayment(s.ports, review('unknown'), 'override');
  assert.equal(s.log.length, 2);
});

test('an old review cannot be used to send: the table may have changed since', async () => {
  const s = sendPorts();
  s.advance(REVIEW_MAX_AGE_MS + 1);
  await assert.rejects(sendPayment(s.ports, review('unknown', 1_000_000), 'none'), (e) => e instanceof PayError && e.code === 'stale-review');
  assert.deepEqual(s.log, []);
});

test('declining the network switch sends nothing', async () => {
  const s = sendPorts({ switchChain: async () => { throw new Error('switch refused'); } });
  await assert.rejects(sendPayment(s.ports, review('unknown'), 'none'), (e) => e instanceof PayError && e.code === 'send-failed');
  assert.ok(!s.log.some((l) => l.startsWith('send')));
});

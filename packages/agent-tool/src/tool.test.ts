import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createClient, LookupError, type LookoutClient } from '@lookout/client';
import { scoreTarget, type ScoringInput, type Signal } from '@lookout/core';
import { CHECK_TARGET_TOOL, decide, guardTransfer, runCheckTarget } from './tool.ts';

const sig = (sourceType: Signal['sourceType']): Signal => ({
  entityId: `e-${sourceType}`, sourceType, sourceId: 's', level: 'block', weight: 1, ageSeconds: 1, note: '',
});
/** A client that answers from the real scoring rule, or fails like a down indexer. */
const clientFor = (over: Partial<ScoringInput> = {}, failWith?: string): LookoutClient => ({
  async checkTarget() {
    if (failWith) throw new LookupError(failWith);
    return { ...scoreTarget({ signals: [], disputed: false, ...over }), snapshotId: 'snap-1', verified: true };
  },
});

test('tool definition is valid tool-use JSON', () => {
  assert.equal(CHECK_TARGET_TOOL.name, 'check_target');
  assert.deepEqual(CHECK_TARGET_TOOL.input_schema.required, ['value']);
  JSON.stringify(CHECK_TARGET_TOOL);
});

test('output is the PRD shape with no UI-only fields', async () => {
  const call = await runCheckTarget(clientFor({ signals: [sig('feed'), sig('checker')] }), { value: 'scam.xyz' });
  assert.ok(call.ok);
  assert.deepEqual(Object.keys(call.result).sort(), ['disputed', 'reasons', 'snapshotId', 'verdict', 'verified']);
  assert.equal(call.result.verdict, 'block');
});

test('block aborts', async () => {
  const { decision } = await guardTransfer(clientFor({ signals: [sig('feed'), sig('checker')] }), { value: 'scam.xyz' });
  assert.equal(decision.action, 'abort');
});

test('warn asks a human, disputed or not', async () => {
  const one = await guardTransfer(clientFor({ signals: [sig('feed')] }), { value: 'a.example' });
  assert.equal(one.decision.action, 'ask_human');
  const disputed = await guardTransfer(clientFor({ disputed: true }), { value: 'a.example' });
  assert.equal(disputed.decision.action, 'ask_human');
  assert.match(disputed.decision.reason, /dispute/);
});

test('unknown proceeds only capped, never as safe', async () => {
  const { decision } = await guardTransfer(clientFor(), { value: 'a.example' });
  assert.equal(decision.action, 'proceed_capped');
  assert.match(decision.reason, /not safe/);
});

test('a failed lookup returns a JSON error and fails closed to a human', async () => {
  const call = await runCheckTarget(clientFor({}, 'indexer returned 500'), { value: 'a.example' });
  assert.equal(call.ok, false);
  assert.equal(decide(call).action, 'ask_human');
});

test('malformed input is an error result, not an exception', async () => {
  const real = createClient({ indexerUrl: 'http://idx', fetch: (async () => { throw new Error('must not be called'); }) as unknown as typeof fetch });
  const call = await runCheckTarget(real, { value: 'not a target' });
  assert.equal(call.ok, false);
  const typo = await runCheckTarget(real, { value: '0x123' });
  assert.equal(typo.ok, false);
});

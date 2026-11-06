import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createClient } from '@lookout/client';
import type { LookupResponse } from '@lookout/client';
import type { Signal } from '@lookout/core';
import { CHECK_TARGET_TOOL, decide, guardTransfer, runCheckTarget } from './tool.ts';

const sig = (sourceType: Signal['sourceType']): Signal => ({
  entityId: `e-${sourceType}`, sourceType, sourceId: 's', level: 'block', weight: 1, ageSeconds: 1, note: '',
});
const clientFor = (body: Partial<LookupResponse>, status = 200) =>
  createClient({
    indexerUrl: 'http://idx',
    fetch: (async () => ({ ok: status === 200, status, json: async () => ({ snapshotId: 'snap-1', disputed: false, signals: [], ...body }) })) as unknown as typeof fetch,
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
  const { decision } = await guardTransfer(clientFor({}), { value: 'a.example' });
  assert.equal(decision.action, 'proceed_capped');
  assert.match(decision.reason, /not safe/);
});

test('a failed lookup returns a JSON error and fails closed to a human', async () => {
  const call = await runCheckTarget(clientFor({}, 500), { value: 'a.example' });
  assert.equal(call.ok, false);
  assert.equal(decide(call).action, 'ask_human');
});

test('malformed input is an error result, not an exception', async () => {
  const call = await runCheckTarget(clientFor({}), { value: 'not a target' });
  assert.equal(call.ok, false);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BUCKET_SIZE } from '@lookout/snapshot';
import { answer, combine, queryPair, randomVector, vectorBytes, withBitFlipped } from './pir.ts';

const table = (n: number) => {
  const t = new Uint8Array(n * BUCKET_SIZE);
  for (let i = 0; i < t.length; i++) t[i] = (i * 31 + (i >> 9) * 7 + 13) & 255; // distinct, non-random content
  return t;
};
const bucket = (t: Uint8Array, i: number) => t.slice(i * BUCKET_SIZE, (i + 1) * BUCKET_SIZE);
const popcount = (v: Uint8Array) => v.reduce((n, b) => n + b.toString(2).replace(/0/g, '').length, 0);

test('correctness: every bucket index comes back exactly (count not a multiple of 8)', () => {
  const n = 301;
  const t = table(n);
  for (let i = 0; i < n; i++) {
    const { a, b } = queryPair(i, n);
    assert.deepEqual(combine(answer(t, n, a), answer(t, n, b)), bucket(t, i), `bucket ${i}`);
  }
});

test('correctness at full demo size, sampled', () => {
  const n = 16_384;
  const t = table(n);
  for (const i of [0, 1, 7, 8, 4095, 8191, 12_345, 16_383]) {
    const { a, b } = queryPair(i, n);
    assert.deepEqual(combine(answer(t, n, a), answer(t, n, b)), bucket(t, i), `bucket ${i}`);
  }
});

test('the two queries differ in exactly the target bit', () => {
  const { a, b } = queryPair(77, 300);
  const diff = a.map((v, i) => v ^ b[i]);
  assert.equal(popcount(diff), 1);
  assert.equal(diff[77 >> 3], 0x80 >> (77 & 7));
});

test('each query on its own is random: the target bit is a coin flip, and density is about one half', () => {
  const n = 512, index = 200, trials = 2000;
  let aOnes = 0, bOnes = 0, density = 0;
  for (let t = 0; t < trials; t++) {
    const { a, b } = queryPair(index, n);
    aOnes += (a[index >> 3] >> (7 - (index & 7))) & 1;
    bOnes += (b[index >> 3] >> (7 - (index & 7))) & 1;
    density += popcount(a) / n;
  }
  // 2000 fair coin flips: mean 1000, sd ~22. Allow 6 sd.
  assert.ok(Math.abs(aOnes - trials / 2) < 135, `server A saw the target bit set ${aOnes}/${trials}`);
  assert.ok(Math.abs(bOnes - trials / 2) < 135, `server B saw the target bit set ${bOnes}/${trials}`);
  assert.ok(Math.abs(density / trials - 0.5) < 0.01);
});

test('the same target gives different queries every time', () => {
  const x = queryPair(5, 256), y = queryPair(5, 256);
  assert.notDeepEqual(x.a, y.a);
});

test('padding bits stay zero, and a server rejects a query that sets them', () => {
  const n = 301;
  for (let i = 0; i < 50; i++) assert.equal(randomVector(n)[vectorBytes(n) - 1] & 0b00000111, 0);
  const bad = new Uint8Array(vectorBytes(n)); bad[bad.length - 1] = 1;
  assert.throws(() => answer(table(n), n, bad), /past the last bucket/);
});

test('inputs are validated', () => {
  assert.throws(() => queryPair(-1, 10));
  assert.throws(() => queryPair(10, 10));
  assert.throws(() => answer(table(10), 10, new Uint8Array(5)), /wrong length/);
  assert.throws(() => answer(new Uint8Array(100), 10, new Uint8Array(2)), /wrong size/);
  assert.throws(() => combine(new Uint8Array(3), new Uint8Array(3)));
  assert.deepEqual(withBitFlipped(new Uint8Array(2), 9), Uint8Array.of(0, 0x40));
});

test('an unaligned table view still answers correctly', () => {
  const n = 64;
  const t = table(n);
  const padded = new Uint8Array(t.length + 1); padded.set(t, 1);
  const view = padded.subarray(1);
  const { a, b } = queryPair(9, n);
  assert.deepEqual(combine(answer(view, n, a), answer(view, n, b)), bucket(t, 9));
});

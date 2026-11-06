import { BUCKET_SIZE } from '@lookout/core';

/**
 * Two-server XOR PIR over the bucket table. To read bucket i without either server learning i:
 * send a random bit vector r to server A and r with bit i flipped to server B. Each server
 * returns the XOR of the buckets its vector selects. XOR the two answers and only bucket i is left.
 * Privacy holds as long as the two servers do not collude. Spec: arkiv/snapshot-format.md.
 *
 * Bit order (Dev A's format): bit j of the vector is (byte[j >> 3] >> (j & 7)) & 1, so the LOWEST bit
 * of each byte is the lowest bucket index. Padding bits, past the last bucket, are the high bits of the last byte.
 */
export const vectorBytes = (bucketCount: number) => Math.ceil(bucketCount / 8);

/** Mask of the bits in the last byte that map to real buckets. */
const lastByteMask = (bucketCount: number) => {
  const valid = bucketCount - (vectorBytes(bucketCount) - 1) * 8; // 1..8
  return valid === 8 ? 0xff : (1 << valid) - 1;
};

/** Uniformly random bits for buckets 0..n-1. Padding bits past n are always zero. */
export function randomVector(bucketCount: number): Uint8Array {
  const v = crypto.getRandomValues(new Uint8Array(vectorBytes(bucketCount)));
  v[v.length - 1] &= lastByteMask(bucketCount); // padding bits are the high bits of the last byte
  return v;
}

export function withBitFlipped(vector: Uint8Array, index: number): Uint8Array {
  const out = vector.slice();
  out[index >> 3] ^= 1 << (index & 7);
  return out;
}

/** The two queries for bucket `index`. Each one alone is a uniformly random vector. */
export function queryPair(index: number, bucketCount: number): { a: Uint8Array; b: Uint8Array } {
  if (!Number.isInteger(index) || index < 0 || index >= bucketCount) throw new Error('bucket index out of range');
  const a = randomVector(bucketCount);
  return { a, b: withBitFlipped(a, index) };
}

/** Server side. XOR of every bucket whose bit is set. Always scans the whole vector. */
export function answer(buckets: Uint8Array, bucketCount: number, vector: Uint8Array): Uint8Array {
  if (buckets.length !== bucketCount * BUCKET_SIZE) throw new Error('bucket table has the wrong size');
  if (vector.length !== vectorBytes(bucketCount)) throw new Error('query vector has the wrong length');
  if ((vector[vector.length - 1] & ~lastByteMask(bucketCount) & 0xff) !== 0) throw new Error('query sets bits past the last bucket');
  const words = BUCKET_SIZE / 4;
  const table = buckets.byteOffset % 4 === 0
    ? new Uint32Array(buckets.buffer, buckets.byteOffset, buckets.length / 4)
    : new Uint32Array(buckets.slice().buffer);
  const acc = new Uint32Array(words);
  for (let byte = 0; byte < vector.length; byte++) {
    const bits = vector[byte];
    if (bits === 0) continue;
    for (let bit = 0; bit < 8; bit++) {
      if (!(bits & (1 << bit))) continue;
      const base = (byte * 8 + bit) * words;
      for (let w = 0; w < words; w++) acc[w] ^= table[base + w];
    }
  }
  return new Uint8Array(acc.buffer, acc.byteOffset, BUCKET_SIZE).slice();
}

export function combine(answerA: Uint8Array, answerB: Uint8Array): Uint8Array {
  if (answerA.length !== BUCKET_SIZE || answerB.length !== BUCKET_SIZE) throw new Error(`answers must be ${BUCKET_SIZE} bytes`);
  return answerA.map((v, i) => v ^ answerB[i]);
}

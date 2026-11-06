import { test } from 'node:test';
import assert from 'node:assert/strict';
import { keccak_256 } from '@noble/hashes/sha3.js';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';
import { generateKeys, metaAddress } from './stealth.ts';
import { SEALED_LENGTH, openMetaAddress, payerEncryptionPublicKey, sealMetaAddress } from './seal.ts';

const k = (label: string) => keccak_256(utf8ToBytes(label));
const PAYER = k('lookout test payer encryption key');
const PAYER_PUB = payerEncryptionPublicKey(PAYER);
const META = 'st:eth:0x02432c0e3eb5b16469c2b996a486cb102e5ef8bed26ed952b49da563a797f8ee9a02f8493a7c42a5248c9cd967b728272141cbb8e75d228723d3268c7e4a4fc2d597';
const FIXED = { ephemeralSecret: k('lookout test seal ephemeral'), nonce: new Uint8Array(12).fill(7) };

test('round trip', () => {
  const blob = sealMetaAddress(META, PAYER_PUB, 'rep_0001');
  assert.equal(blob.length, SEALED_LENGTH);
  assert.equal(openMetaAddress(blob, PAYER, 'rep_0001'), META);
});

test('pinned vector (changing it breaks every sealed report on Arkiv)', () => {
  const blob = sealMetaAddress(META, PAYER_PUB, 'rep_0001', FIXED);
  assert.equal(PAYER_PUB, '0x03a73c5ad494ceaf0371f7899430ee89acf5e971f65ddae6470c6291b9da8cc061');
  // also opened by an independent Python implementation (hand-rolled secp256k1 + `cryptography` HKDF/ChaCha20-Poly1305)
  assert.equal(bytesToHex(blob), '0103b22c9307814a8089db73393e50c3b7afa0412b3f4d3904943ccb4375ea563ae3070707070707070707070707a87547adde35070f9bba75e47e9a728364c74bdbb739e70dfec5ea78b9b61b0a17c2f8fa1bc66a6bbe320b380d339ab1052790308831e1af960f9ae4397cec5252f689231c0ec62f7158c5533d747f0c4adb');
});

test('the same meta-address sealed twice looks unrelated, so reports cannot be linked', () => {
  const a = sealMetaAddress(META, PAYER_PUB, 'rep_0001');
  const b = sealMetaAddress(META, PAYER_PUB, 'rep_0001');
  assert.notDeepEqual(a, b);
  assert.notDeepEqual(a.slice(1, 34), b.slice(1, 34)); // fresh ephemeral key each time
});

test('the meta-address does not appear in the blob', () => {
  const blob = bytesToHex(sealMetaAddress(META, PAYER_PUB, 'rep_0001'));
  assert.ok(!blob.includes(META.slice(9, 49)));
});

test('wrong report, wrong key and any flipped byte are all rejected', () => {
  const blob = sealMetaAddress(META, PAYER_PUB, 'rep_0001');
  assert.throws(() => openMetaAddress(blob, PAYER, 'rep_0002'), /cannot open/);
  assert.throws(() => openMetaAddress(blob, k('someone else'), 'rep_0001'), /cannot open/);
  for (let i = 1; i < blob.length; i++) {
    const bad = blob.slice();
    bad[i] ^= 1;
    assert.throws(() => openMetaAddress(bad, PAYER, 'rep_0001'), Error, `byte ${i}`);
  }
});

test('malformed blobs are rejected', () => {
  const blob = sealMetaAddress(META, PAYER_PUB, 'rep_0001');
  assert.throws(() => openMetaAddress(blob.slice(1), PAYER, 'rep_0001'), /128 bytes/);
  const v2 = blob.slice(); v2[0] = 2;
  assert.throws(() => openMetaAddress(v2, PAYER, 'rep_0001'), /version/);
});

test('rejects a bad meta-address or payer key before encrypting', () => {
  assert.throws(() => sealMetaAddress('st:eth:0xabc', PAYER_PUB, 'rep_0001'));
  assert.throws(() => sealMetaAddress(META, `0x${'00'.repeat(33)}`, 'rep_0001'));
});

test('works for freshly generated keys', () => {
  for (let i = 0; i < 10; i++) {
    const meta = metaAddress(generateKeys());
    assert.equal(openMetaAddress(sealMetaAddress(meta, PAYER_PUB, `rep_${i}`), PAYER, `rep_${i}`), meta);
  }
});

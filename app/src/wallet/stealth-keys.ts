import { generateKeys, metaAddress, type StealthKeys } from '@lookout/stealth';

/**
 * The reporter's bounty keys. They are made in THIS browser and never sent anywhere: only the public meta-address leaves the
 * device, and even that only sealed so that the panel alone can read it.
 *
 *   spending key   moves the bounty. Whoever holds it owns the money.
 *   viewing key    finds which one-time addresses were paid to you. It cannot spend.
 *
 * They live in localStorage, which means: clearing site data, or using another browser, loses access to any bounty paid to them.
 * The page tells the person to back them up (exportKeys). A wallet-derived or encrypted backup is not built yet.
 */

const KEY = 'lookout.stealth.v0';

const toHex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
const fromHex = (h: string) => Uint8Array.from((h.match(/../g) ?? []).map((x) => parseInt(x, 16)));

export function loadKeys(): StealthKeys | null {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return null;
    const j = JSON.parse(raw) as { s: string; v: string };
    if (!/^[0-9a-f]{64}$/.test(j.s) || !/^[0-9a-f]{64}$/.test(j.v)) return null;
    return { spendingKey: fromHex(j.s), viewingKey: fromHex(j.v) };
  } catch {
    return null;
  }
}

/** The saved keys, or new ones saved now. Never overwrites existing keys. */
export function loadOrCreateKeys(): StealthKeys {
  const existing = loadKeys();
  if (existing) return existing;
  const keys = generateKeys();
  window.localStorage.setItem(KEY, JSON.stringify({ s: toHex(keys.spendingKey), v: toHex(keys.viewingKey) }));
  return keys;
}

/** A text backup the person can store somewhere safe. Contains the SPENDING key: treat it like a password. */
export function exportKeys(): string | null {
  const k = loadKeys();
  return k ? `lookout-stealth-v0:${toHex(k.spendingKey)}:${toHex(k.viewingKey)}` : null;
}

export const myMetaAddress = (): string | null => {
  const k = loadKeys();
  return k ? metaAddress(k) : null;
};

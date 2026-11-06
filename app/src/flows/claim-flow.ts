import { parseMetaAddress, stealthAddressFor, stealthPrivateKey, sweepValue, metaAddress, type StealthKeys } from '@lookout/stealth';

/**
 * Collecting a private bounty.
 *
 * The operator pays each bounty to a one-time address that only the reporter can work out. The reporter's own keys, kept in this
 * browser, find those addresses and can spend from them. This module is the logic; the page only shows it.
 *
 *   findBounties   for each report this browser filed, look for a bounty announcement and work out where it was paid
 *   sweepBounty    move the money out. The one-time address pays its own gas (no relayer), so it sends balance minus the fee
 *
 * PRIVACY: sending the bounty straight to the wallet that filed the report would link the two and undo the point of a private
 * bounty. So the destination is checked against the wallets we know are the reporter's, and a linked destination is refused
 * unless the person explicitly accepts that.
 */

export interface BountyAnnouncement {
  reportId: string;
  /** the operator's one-time public key R for this bounty, 0x + 33 bytes */
  ephemeralPublicKey: string;
}

export interface FoundBounty {
  reportId: string;
  stealthAddress: string;
  ephemeralPublicKey: string;
  balanceWei: bigint;
}

export interface ClaimPorts {
  announcements(reportId: string): Promise<BountyAnnouncement[]>;
  balance(address: string): Promise<bigint>;
  gasPrice(): Promise<bigint>;
  /** sign with the one-time private key and send plain ETH. gasPrice is fixed so the fee is exactly what was reserved */
  sendFrom(privateKey: Uint8Array, to: string, wei: bigint, gasPrice: bigint): Promise<{ hash: string }>;
}

export class ClaimError extends Error {
  code: 'bad-destination' | 'linked-destination' | 'nothing-to-claim' | 'too-small' | 'send-failed';
  constructor(code: ClaimError['code'], message: string) {
    super(message);
    this.name = 'ClaimError';
    this.code = code;
  }
}

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const ZERO = '0x0000000000000000000000000000000000000000';

/** Finds every bounty announced for the given reports and works out where each one was paid, using only the reporter's own keys. */
export async function findBounties(ports: ClaimPorts, reportIds: readonly string[], keys: StealthKeys): Promise<FoundBounty[]> {
  const { spendingPub } = parseMetaAddress(metaAddress(keys));
  const out: FoundBounty[] = [];
  for (const reportId of [...new Set(reportIds)]) {
    for (const a of await ports.announcements(reportId)) {
      let address: string;
      try {
        address = stealthAddressFor(keys.viewingKey, spendingPub, a.ephemeralPublicKey);
      } catch {
        continue; // a malformed announcement for one of our report ids must not hide the others
      }
      out.push({ reportId, stealthAddress: address, ephemeralPublicKey: a.ephemeralPublicKey, balanceWei: await ports.balance(address) });
    }
  }
  return out;
}

/** Is paying this destination a link back to the reporter? `knownWallets` are the addresses we know belong to them. */
export function isLinkedDestination(destination: string, knownWallets: readonly string[]): boolean {
  return knownWallets.some((w) => w.toLowerCase() === destination.toLowerCase());
}

export async function sweepBounty(
  ports: ClaimPorts,
  keys: StealthKeys,
  bounty: FoundBounty,
  destination: string,
  opts: { knownWallets?: readonly string[]; allowLinked?: boolean } = {},
): Promise<{ hash: string; sentWei: bigint }> {
  if (!ADDRESS.test(destination) || destination.toLowerCase() === ZERO) throw new ClaimError('bad-destination', 'Enter the full address to send the bounty to.');
  if (destination.toLowerCase() === bounty.stealthAddress.toLowerCase()) throw new ClaimError('bad-destination', 'That is the one-time address itself.');
  if (!opts.allowLinked && isLinkedDestination(destination, opts.knownWallets ?? [])) {
    throw new ClaimError('linked-destination', 'That address belongs to the wallet that filed the report. Sending the bounty there links the two and defeats the point of a private bounty. Use a fresh address, or confirm you accept the link.');
  }

  const balance = await ports.balance(bounty.stealthAddress); // read again: it may have changed
  if (balance <= 0n) throw new ClaimError('nothing-to-claim', 'There is nothing at that address (already swept, or not paid yet).');
  const gasPrice = await ports.gasPrice();
  const value = sweepValue(balance, gasPrice);
  if (value === null) throw new ClaimError('too-small', 'The bounty is smaller than the fee to move it.');

  const secret = stealthPrivateKey(keys, bounty.ephemeralPublicKey);
  try {
    const { hash } = await ports.sendFrom(secret, destination, value, gasPrice);
    return { hash, sentWei: value };
  } catch (e) {
    throw new ClaimError('send-failed', e instanceof Error ? e.message : String(e));
  } finally {
    secret.fill(0); // do not leave the one-time key lying around in memory
  }
}

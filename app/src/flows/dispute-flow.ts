import { disputeMessage, normalizeTarget, targetHash } from '@lookout/core';

/**
 * Disputing a flag as the OWNER of the flagged address.
 *
 * The owner signs a fixed message with the address's own key. That signature is the proof (core/owner-proof.ts): nobody else
 * can make it, and every indexer and the operator can check it without trusting anyone. The dispute is then written to Arkiv from
 * the same wallet. A dispute never clears a flag by itself: it puts the flag in front of the operator, and only a ruling can overturn it.
 *
 * Only an ordinary wallet address can be disputed this way. A contract has no key to sign with, and a domain needs a different
 * proof that is not built yet. Those owners can still ask for review by reporting with a deposit.
 */

export type DisputeStep = 'validate' | 'sign' | 'post' | 'done';

export class DisputeError extends Error {
  code: 'not-an-address' | 'wrong-wallet' | 'no-wallet' | 'declined' | 'post-failed';
  constructor(code: DisputeError['code'], message: string) {
    super(message);
    this.name = 'DisputeError';
    this.code = code;
  }
}

export interface DisputePorts {
  /** the connected wallet, lowercase, or null */
  connected(): string | null;
  /** personal_sign through the wallet. Rejects if the person declines */
  sign(message: string): Promise<string>;
  switchChain(): Promise<void>;
  post(input: { target: string; signature: string }): Promise<{ entityKey: string }>;
}

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Why this person cannot dispute right now, or null if they can. Used to show or hide the button. */
export function whyNotDispute(target: string, connected: string | null): string | null {
  if (!ADDRESS.test(target)) return 'Only a wallet address can be disputed by its owner. A contract has no key to sign with, and a domain needs a proof that is not built yet.';
  if (!connected) return 'Connect the wallet that owns this address to dispute the flag.';
  if (connected.toLowerCase() !== target.toLowerCase()) return 'Only the owner can dispute, by signing with this address. Connect that wallet. Anyone else can report instead.';
  return null;
}

export async function runDispute(ports: DisputePorts, targetAddress: string, onStep: (s: DisputeStep) => void = () => {}): Promise<{ entityKey: string; signature: string }> {
  onStep('validate');
  const connected = ports.connected();
  const why = whyNotDispute(targetAddress, connected);
  if (why) throw new DisputeError(!ADDRESS.test(targetAddress) ? 'not-an-address' : !connected ? 'no-wallet' : 'wrong-wallet', why);
  const target = normalizeTarget('address', targetAddress);
  const hash = targetHash('address', target);

  onStep('sign');
  let signature: string;
  try {
    signature = await ports.sign(disputeMessage(hash));
  } catch (e) {
    throw new DisputeError('declined', `The signature was not given: ${message(e)}`);
  }

  onStep('post');
  try {
    await ports.switchChain();
    const out = await ports.post({ target, signature });
    onStep('done');
    return { entityKey: out.entityKey, signature };
  } catch (e) {
    throw new DisputeError('post-failed', message(e));
  }
}

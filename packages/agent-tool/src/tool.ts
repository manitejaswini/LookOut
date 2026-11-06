import type { CheckResult, TargetKind } from '@lookout/core';
import type { LookoutClient } from '@lookout/client';

/** The PRD `checkTarget` shape, without the UI-only fields the wallet screen adds. */
export type CheckTargetOutput = Pick<CheckResult, 'verdict' | 'disputed' | 'reasons' | 'snapshotId' | 'verified'>;

export type CheckTargetCall =
  | { ok: true; result: CheckTargetOutput }
  | { ok: false; error: string };

export type AgentAction = 'abort' | 'ask_human' | 'proceed_capped';

export interface AgentDecision {
  action: AgentAction;
  reason: string;
}

/** Tool definition in the shape LLM tool-use APIs expect (name, description, JSON Schema). */
export const CHECK_TARGET_TOOL = {
  name: 'check_target',
  description:
    'Check a domain, address or contract against Lookout before you send funds, sign, or approve anything. ' +
    'Returns verdict "block", "warn" or "unknown". On "block" do not proceed. On "warn" stop and ask a human. ' +
    '"unknown" means nothing was found, which is not the same as safe.',
  input_schema: {
    type: 'object',
    properties: {
      value: { type: 'string', description: 'A domain such as example.com, or a 0x address' },
      kind: { type: 'string', enum: ['domain', 'address', 'contract'], description: 'Optional. Inferred from value if omitted.' },
    },
    required: ['value'],
  },
} as const;

/**
 * Runs the tool. Never throws: an agent gets a JSON error it can reason about, and a failed
 * lookup is never mistaken for a clean result.
 */
export async function runCheckTarget(
  client: LookoutClient,
  input: { value: string; kind?: TargetKind },
): Promise<CheckTargetCall> {
  try {
    const { verdict, disputed, reasons, snapshotId, verified } = await client.checkTarget(input.value, input.kind);
    return { ok: true, result: { verdict, disputed, reasons, snapshotId, verified } };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/**
 * What a well-behaved agent does with the answer. Fails closed: if Lookout could not answer,
 * the agent asks a human rather than assuming the target is fine.
 */
export function decide(call: CheckTargetCall): AgentDecision {
  if (!call.ok) return { action: 'ask_human', reason: `Lookout could not check this target (${call.error}).` };
  const { verdict, disputed } = call.result;
  if (verdict === 'block') return { action: 'abort', reason: 'Lookout blocks this target. Transfer aborted.' };
  if (verdict === 'warn') {
    return { action: 'ask_human', reason: disputed ? 'Flagged and under dispute. Pausing for a human.' : 'Flagged with a warning. Pausing for a human.' };
  }
  return { action: 'proceed_capped', reason: 'Nothing found. Unknown is not safe, so proceed with a capped amount.' };
}

/** One call for an agent loop: check, then decide. */
export async function guardTransfer(client: LookoutClient, target: { value: string; kind?: TargetKind }) {
  const call = await runCheckTarget(client, target);
  return { call, decision: decide(call) };
}

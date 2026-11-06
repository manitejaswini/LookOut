import { normalizeTarget, type TargetKind } from '@lookout/core';
import { ENUMS } from '@lookout/arkiv';

/**
 * Posting a report is two transactions on two chains: the deposit (escrow, Sepolia) and the report entity (Arkiv).
 * The deposit goes FIRST, so there is never a report on Arkiv whose deposit does not exist.
 *
 * If the second step fails the deposit is already locked. That is not lost: the flow reports it, can resume with the SAME
 * report id (so the deposit is not paid twice), and the reporter can always reclaim it after the escrow's window.
 */

export const CATEGORIES = ENUMS.category;
export type Category = (typeof CATEGORIES)[number];
export const TARGET_KINDS: readonly TargetKind[] = ['domain', 'address', 'contract'];

export type ReportStep = 'validate' | 'deposit' | 'post' | 'done';

export interface ReportInput {
  kind: TargetKind;
  value: string;
  category: Category;
  /** attach a sealed bounty address, so a confirmed report can be paid privately */
  bounty?: boolean;
}

export interface ReportPorts {
  newReportId(): string;
  /** asks the wallet to switch network. Rejects if the person declines */
  switchChain(which: 'escrow' | 'arkiv'): Promise<void>;
  deposit(reportId: string): Promise<{ hash: string }>;
  post(input: ReportInput & { reportId: string }): Promise<{ entityKey: string; expiresAt: string }>;
}

export class FlowError extends Error {
  step: ReportStep;
  reportId?: string;
  /** true once the deposit transaction succeeded */
  depositLocked: boolean;
  depositTx?: string;
  constructor(step: ReportStep, message: string, extra: { reportId?: string; depositLocked?: boolean; depositTx?: string } = {}) {
    super(message);
    this.name = 'FlowError';
    this.step = step;
    this.reportId = extra.reportId;
    this.depositLocked = extra.depositLocked ?? false;
    this.depositTx = extra.depositTx;
  }
}

export interface ReportResult {
  reportId: string;
  depositTx: string;
  entityKey: string;
  expiresAt: string;
}

export interface Resume {
  reportId: string;
  depositTx: string;
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Checks the input without touching the wallet. Returns the problem, or null. */
export function validateReport(input: ReportInput): string | null {
  if (!(TARGET_KINDS as readonly string[]).includes(input.kind)) return `pick what you are reporting: ${TARGET_KINDS.join(', ')}`;
  if (!(CATEGORIES as readonly string[]).includes(input.category)) return 'pick a category';
  try {
    normalizeTarget(input.kind, input.value);
  } catch (e) {
    return message(e);
  }
  return null;
}

export async function runReportFlow(
  ports: ReportPorts,
  input: ReportInput,
  onStep: (s: ReportStep) => void = () => {},
  resume?: Resume,
): Promise<ReportResult> {
  onStep('validate');
  const problem = validateReport(input);
  if (problem) throw new FlowError('validate', problem);

  const reportId = resume?.reportId ?? ports.newReportId();
  let depositTx = resume?.depositTx;

  if (!depositTx) {
    onStep('deposit');
    try {
      await ports.switchChain('escrow');
      depositTx = (await ports.deposit(reportId)).hash;
    } catch (e) {
      throw new FlowError('deposit', message(e), { reportId });
    }
  }

  onStep('post');
  try {
    await ports.switchChain('arkiv');
    const out = await ports.post({ ...input, reportId });
    onStep('done');
    return { reportId, depositTx, entityKey: out.entityKey, expiresAt: out.expiresAt };
  } catch (e) {
    throw new FlowError('post', message(e), { reportId, depositLocked: true, depositTx });
  }
}

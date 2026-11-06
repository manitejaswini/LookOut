import {
  BaseError, ContractFunctionRevertedError, getAddress, isAddress, parseEventLogs,
  type Address, type Hex, type PublicClient, type WalletClient,
} from 'viem';
import { escrowAbi, escrowBytecode } from './artifact.ts';

/**
 * A typed client for LookoutEscrow (contracts/src/LookoutEscrow.sol). It never holds a key: it is given a viem wallet client.
 *
 * Every write is SIMULATED first, so a revert comes back as its real contract error name (NotResolver, WrongAmount, ...)
 * before any gas is spent, instead of as an opaque "execution reverted".
 */

/** The contract's custom errors, by name. */
export type EscrowErrorCode =
  | 'NotResolver' | 'Reentrant' | 'WrongAmount' | 'AlreadyExists' | 'NotLocked' | 'TooEarly' | 'NothingToClaim'
  | 'ZeroAddress' | 'TransferFailed' | 'BadConfig' | 'Unknown';

export class EscrowError extends Error {
  code: EscrowErrorCode;
  constructor(code: EscrowErrorCode, message: string) {
    super(message);
    this.name = 'EscrowError';
    this.code = code;
  }
}

/** Turns a viem failure into an EscrowError carrying the contract's own error name when there is one. */
export function explain(e: unknown): EscrowError {
  if (e instanceof EscrowError) return e;
  if (e instanceof BaseError) {
    const reverted = e.walk((x) => x instanceof ContractFunctionRevertedError) as ContractFunctionRevertedError | null;
    const name = reverted?.data?.errorName;
    if (name) return new EscrowError(name as EscrowErrorCode, `the escrow refused this: ${name}`);
    return new EscrowError('Unknown', e.shortMessage);
  }
  return new EscrowError('Unknown', e instanceof Error ? e.message : String(e));
}

/* ---------------------------- report id conversion --------------------------- */

const REPORT_ID = /^[0-9a-f]{32}$/;

/** The 32-hex-digit report id from Arkiv, as the contract's bytes16. */
export function toBytes16(reportId: string): Hex {
  if (!REPORT_ID.test(reportId)) throw new EscrowError('Unknown', 'reportId must be 32 lowercase hex digits');
  return `0x${reportId}`;
}

export const fromBytes16 = (h: string): string => h.replace(/^0x/, '').toLowerCase();

/* --------------------------------- the client -------------------------------- */

export interface EscrowConfig {
  resolver: Address;
  depositWei: bigint;
  bountyWei: bigint;
  resolveWindow: bigint;
}

export type DepositStatus = 'none' | 'locked' | 'returned' | 'slashed' | 'reclaimed' | 'refunded';
const STATUS: DepositStatus[] = ['none', 'locked', 'returned', 'slashed', 'reclaimed', 'refunded'];

export interface TxResult {
  hash: Hex;
  blockNumber: bigint;
  gasUsed: bigint;
}

/** A deposit seen on chain. This is exactly what the Arkiv `stake` entity mirrors. */
export interface DepositedEvent {
  reporter: Address;
  /** 32 lowercase hex digits, the Arkiv report id */
  reportId: string;
  amount: bigint;
  txHash: Hex;
  blockNumber: bigint;
}

export type SettlementKind = 'confirmed' | 'rejected' | 'reclaimed' | 'refunded';

export interface SettledEvent {
  kind: SettlementKind;
  /** wei of bounty credited with a confirmation. Zero otherwise */
  bountyWei: bigint;
  reporter: Address;
  reportId: string;
  txHash: Hex;
  blockNumber: bigint;
}

export interface EscrowDeps {
  address: Address;
  publicClient: PublicClient;
  /** needed only for writes */
  walletClient?: WalletClient;
}

export function createEscrow(deps: EscrowDeps) {
  const { address, publicClient } = deps;

  async function send(functionName: string, args: readonly unknown[], value?: bigint): Promise<TxResult> {
    const wallet = deps.walletClient;
    if (!wallet?.account) throw new EscrowError('Unknown', 'this action needs a wallet client with an account');
    try {
      // @ts-expect-error viem's generic overloads are too deep for a dynamic function name; the ABI itself is typed in artifact.ts
      const { request } = await publicClient.simulateContract({ address, abi: escrowAbi, functionName, args, value, account: wallet.account });
      // the request was just produced by simulateContract for this exact call, so it is already correct
      const hash = await wallet.writeContract(request as never);
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== 'success') throw new EscrowError('Unknown', 'the transaction was mined but failed');
      return { hash, blockNumber: receipt.blockNumber, gasUsed: receipt.gasUsed };
    } catch (e) {
      throw explain(e);
    }
  }

  const read = async <T>(functionName: string, args: readonly unknown[] = []): Promise<T> =>
    // @ts-expect-error see above
    (await publicClient.readContract({ address, abi: escrowAbi, functionName, args })) as T;

  async function config(): Promise<EscrowConfig> {
    const [resolver, depositWei, bountyWei, resolveWindow] = await Promise.all([
      read<Address>('resolver'), read<bigint>('depositWei'), read<bigint>('bountyWei'), read<bigint>('resolveWindow'),
    ]);
    return { resolver, depositWei, bountyWei, resolveWindow: BigInt(resolveWindow) };
  }

  const checked = (a: string): Address => {
    if (!isAddress(a)) throw new EscrowError('ZeroAddress', `not an address: ${a}`);
    return getAddress(a);
  };

  return {
    address,
    config,

    /* ----- reads ----- */
    async deposit(reporter: string, reportId: string): Promise<{ status: DepositStatus; lockedAt: bigint }> {
      const key = await read<Hex>('depositKey', [checked(reporter), toBytes16(reportId)]);
      const [, status, lockedAt] = await read<readonly [Address, number, bigint]>('deposits', [key]);
      return { status: STATUS[status] ?? 'none', lockedAt: BigInt(lockedAt) };
    },
    claimable: (who: string) => read<bigint>('claimable', [checked(who)]),
    bountyPool: () => read<bigint>('bountyPool'),
    totals: async () => ({
      locked: await read<bigint>('totalLocked'),
      claimable: await read<bigint>('totalClaimable'), pool: await read<bigint>('bountyPool'),
    }),
    balance: () => publicClient.getBalance({ address }),

    /* ----- reporter ----- */
    /** Locks the exact deposit for a report. */
    async lockDeposit(reportId: string): Promise<TxResult> {
      return send('deposit', [toBytes16(reportId)], (await config()).depositWei);
    },
    reclaim: (reportId: string) => send('reclaim', [toBytes16(reportId)]),
    claim: () => send('claim', []),

    /* ----- resolver (the panel service's wallet) ----- */
    /** A trusted source corroborated the report: the deposit goes back, plus a bounty from the pool when `withBounty` and the pool can pay it. */
    confirm: (reporter: string, reportId: string, withBounty: boolean) => send('confirm', [checked(reporter), toBytes16(reportId), withBounty]),
    reject: (reporter: string, reportId: string) => send('reject', [checked(reporter), toBytes16(reportId)]),
    /** The report added nothing new or was not corroborated in time: the deposit goes back, with NO bounty. */
    refund: (reporter: string, reportId: string) => send('refund', [checked(reporter), toBytes16(reportId)]),

    /** Anyone may add to the bounty pool. A plain transfer lands there too. */
    async fundPool(valueWei: bigint): Promise<TxResult> {
      const wallet = deps.walletClient;
      if (!wallet?.account) throw new EscrowError('Unknown', 'this action needs a wallet client with an account');
      try {
        const hash = await wallet.sendTransaction({ to: address, value: valueWei, account: wallet.account, chain: wallet.chain });
        const receipt = await publicClient.waitForTransactionReceipt({ hash });
        return { hash, blockNumber: receipt.blockNumber, gasUsed: receipt.gasUsed };
      } catch (e) {
        throw explain(e);
      }
    },

    /* ----- events, for mirroring escrow state into Arkiv ----- */
    async depositEvents(fromBlock: bigint, toBlock?: bigint): Promise<DepositedEvent[]> {
      const logs = await publicClient.getLogs({ address, fromBlock, toBlock });
      return parseEventLogs({ abi: escrowAbi, logs, eventName: 'Deposited' }).map((l) => ({
        reporter: l.args.reporter, reportId: fromBytes16(l.args.reportId), amount: l.args.amount, txHash: l.transactionHash, blockNumber: l.blockNumber,
      }));
    },
    async settledEvents(fromBlock: bigint, toBlock?: bigint): Promise<SettledEvent[]> {
      const logs = await publicClient.getLogs({ address, fromBlock, toBlock });
      const out: SettledEvent[] = [];
      for (const [name, kind] of [['Confirmed', 'confirmed'], ['Rejected', 'rejected'], ['Reclaimed', 'reclaimed'], ['Refunded', 'refunded']] as const) {
        for (const l of parseEventLogs({ abi: escrowAbi, logs, eventName: name })) {
          out.push({ kind, bountyWei: kind === 'confirmed' ? BigInt((l.args as { bounty?: bigint }).bounty ?? 0n) : 0n, reporter: l.args.reporter, reportId: fromBytes16(l.args.reportId), txHash: l.transactionHash, blockNumber: l.blockNumber });
        }
      }
      return out.sort((a, b) => (a.blockNumber === b.blockNumber ? 0 : a.blockNumber < b.blockNumber ? -1 : 1));
    },
  };
}

export type Escrow = ReturnType<typeof createEscrow>;

/* ---------------------------------- deploying -------------------------------- */

export interface DeployArgs {
  publicClient: PublicClient;
  walletClient: WalletClient;
  resolver: string;
  depositWei: bigint;
  bountyWei: bigint;
  resolveWindow: bigint;
}

export async function deployEscrow(a: DeployArgs): Promise<{ address: Address; hash: Hex; blockNumber: bigint }> {
  if (!a.walletClient.account) throw new EscrowError('Unknown', 'deploying needs a wallet client with an account');
  if (!isAddress(a.resolver)) throw new EscrowError('ZeroAddress', 'resolver is not an address');
  try {
    const hash = await a.walletClient.deployContract({
      abi: escrowAbi, bytecode: escrowBytecode, account: a.walletClient.account, chain: a.walletClient.chain,
      args: [getAddress(a.resolver), a.depositWei, a.bountyWei, a.resolveWindow],
    });
    const receipt = await a.publicClient.waitForTransactionReceipt({ hash });
    if (!receipt.contractAddress || receipt.status !== 'success') throw new EscrowError('Unknown', 'the deployment failed');
    return { address: receipt.contractAddress, hash, blockNumber: receipt.blockNumber };
  } catch (e) {
    throw explain(e);
  }
}

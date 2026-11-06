import { drawJurors, PanelError, tally, type Candidate, type Reveal, type Tally, type TargetKind } from '@lookout/core';
import type { Journal } from './journal.ts';
import type { ReportCase, SettleResult } from './settle.ts';

/**
 * The round driver: moves a case through its phases as time and blocks pass.
 *
 *   awaiting-seed -> commit -> reveal -> (settled | next round | unresolved)
 *
 * It holds no decisions of its own. WHO judges comes from core `drawJurors` using a seed that did not exist when the case
 * was opened (the hash of a block `seedDelayBlocks` later), WHAT they decided comes from core `tally`, and the money
 * moves in `settleReportCase`. The driver only decides WHEN. Run `tick()` on a timer; it is safe to run as often as you like.
 *
 * Every state change is written to the journal before the next step, so a restart resumes where it stopped.
 */

export interface DriverConfig {
  commitSeconds: number;
  revealSeconds: number;
  /** odd */
  panelSize: number;
  quorum: number;
  minStakeWei: bigint;
  minRep: number;
  /** the seed is the hash of the block this many blocks after the case opened, so nobody could know it at open time */
  seedDelayBlocks: number;
  /** a tie or a missing quorum starts a new round with a fresh draw, up to this many rounds */
  maxRounds: number;
}

export interface VoteRow {
  juror: string;
  commitHash: string;
  /** unix seconds the commitment was created, from its block */
  createdAt: number;
  outcome?: 'block' | 'clear';
  salt?: string;
}

export interface DriverPorts {
  journal: Journal;
  now: () => number;
  currentBlock: () => Promise<number>;
  /** null while that block does not exist yet */
  blockHash: (block: number) => Promise<string | null>;
  candidates: () => Promise<Candidate[]>;
  readVotes: (caseId: string) => Promise<VoteRow[]>;
  settle: (c: ReportCase, t: Tally) => Promise<SettleResult>;
}

export interface CaseRequest {
  caseId: string;
  reportId: string;
  reporter: string;
  kind: TargetKind;
  value: string;
  reporterMeta?: string;
  /** wallets that may not judge: the reporter, whoever disputed, the target's claimed owner */
  exclude: readonly string[];
}

export type Phase = 'awaiting-seed' | 'commit' | 'reveal' | 'settled' | 'unresolved';

export interface CaseState {
  request: CaseRequest;
  phase: Phase;
  round: number;
  openedBlock: number;
  seed?: string;
  jurors?: string[];
  commitEnd?: number;
  revealEnd?: number;
  /** wallets that failed to reveal in an earlier round, kept off the next panel */
  dropped: string[];
  note?: string;
  result?: 'confirmed' | 'rejected';
}

const INDEX = 'cases:index';
const key = (id: string) => `case:${id}`;
const FINAL: Phase[] = ['settled', 'unresolved'];

export const DEFAULT_DRIVER_CONFIG: DriverConfig = {
  commitSeconds: 3 * 86_400, revealSeconds: 2 * 86_400, panelSize: 5, quorum: 3,
  minStakeWei: 10n ** 17n, minRep: 0, seedDelayBlocks: 5, maxRounds: 3,
};

export function createDriver(ports: DriverPorts, cfg: DriverConfig = DEFAULT_DRIVER_CONFIG) {
  const { journal } = ports;

  const load = (id: string): CaseState | null => {
    const s = journal.detail(key(id));
    return s ? (JSON.parse(s) as CaseState) : null;
  };
  const save = (id: string, s: CaseState) => journal.mark(key(id), JSON.stringify(s));
  const ids = (): string[] => JSON.parse(journal.detail(INDEX) ?? '[]') as string[];

  /** Opens a case. Opening the same case twice returns the first one unchanged. */
  async function open(req: CaseRequest): Promise<CaseState> {
    const existing = load(req.caseId);
    if (existing) return existing;
    const s: CaseState = { request: { ...req, exclude: req.exclude.map((w) => w.toLowerCase()) }, phase: 'awaiting-seed', round: 1, openedBlock: await ports.currentBlock(), dropped: [] };
    save(req.caseId, s);
    journal.mark(INDEX, JSON.stringify([...ids(), req.caseId]));
    return s;
  }

  /** One step at most. Returns the new state if it changed. */
  async function step(s: CaseState): Promise<CaseState | null> {
    const r = s.request;
    const now = ports.now();

    if (s.phase === 'awaiting-seed') {
      const at = s.openedBlock + cfg.seedDelayBlocks;
      if ((await ports.currentBlock()) < at) return null;
      const seed = await ports.blockHash(at);
      if (!seed) return null;
      let jurors: string[];
      try {
        jurors = drawJurors({
          caseId: r.caseId, seed, candidates: await ports.candidates(), size: cfg.panelSize,
          exclude: [...r.exclude, ...s.dropped], minRep: cfg.minRep, minStakeWei: cfg.minStakeWei,
        });
      } catch (e) {
        if (e instanceof PanelError && e.code === 'TooFewEligible') return { ...s, note: e.message }; // wait for more reviewers
        throw e;
      }
      return { ...s, phase: 'commit', seed, jurors, commitEnd: now + cfg.commitSeconds, note: undefined };
    }

    if (s.phase === 'commit') {
      if (now < s.commitEnd!) return null;
      return { ...s, phase: 'reveal', revealEnd: now + cfg.revealSeconds };
    }

    if (s.phase === 'reveal') {
      if (now < s.revealEnd!) return null;
      const jurors = s.jurors!;
      const rows = await ports.readVotes(r.caseId);
      const commits = new Map<string, string>();
      const reveals = new Map<string, Reveal>();
      // earliest commitment per juror wins, and a commitment made after the commit round closed does not count
      for (const v of [...rows].sort((a, b) => a.createdAt - b.createdAt)) {
        const j = v.juror.toLowerCase();
        if (!jurors.includes(j) || commits.has(j) || v.createdAt > s.commitEnd!) continue;
        commits.set(j, v.commitHash);
        if (v.outcome && v.salt) reveals.set(j, { outcome: v.outcome, salt: v.salt });
      }
      const t = tally({ caseId: r.caseId, jurors, commits, reveals, quorum: cfg.quorum });

      if (t.status === 'ruled') {
        const c: ReportCase = { caseId: r.caseId, reportId: r.reportId, reporter: r.reporter, kind: r.kind, value: r.value, jurors, seed: s.seed!, reporterMeta: r.reporterMeta };
        const out = await ports.settle(c, t);
        return { ...s, phase: 'settled', result: out.result ?? undefined, note: undefined };
      }
      if (s.round >= cfg.maxRounds) {
        return { ...s, phase: 'unresolved', note: `no ruling after ${s.round} rounds (${t.reason}); the deposit stays locked until the reporter reclaims it` };
      }
      return {
        ...s, phase: 'awaiting-seed', round: s.round + 1, openedBlock: await ports.currentBlock(),
        seed: undefined, jurors: undefined, commitEnd: undefined, revealEnd: undefined,
        dropped: [...new Set([...s.dropped, ...t.nonReveal])], note: `round ${s.round} was ${t.reason}`,
      };
    }
    return null;
  }

  /** Advances every open case as far as time allows. A failure in one case is reported and does not stop the others. */
  async function tick(): Promise<{ id: string; phase: Phase; error?: string }[]> {
    const out: { id: string; phase: Phase; error?: string }[] = [];
    for (const id of ids()) {
      let s = load(id);
      if (!s || FINAL.includes(s.phase)) continue;
      try {
        for (let i = 0; i < 6; i++) {
          const next = await step(s);
          if (!next) break;
          s = next;
          save(id, s);
          if (FINAL.includes(s.phase)) break;
        }
        out.push({ id, phase: s.phase });
      } catch (e) {
        out.push({ id, phase: s.phase, error: e instanceof Error ? e.message : String(e) });
      }
    }
    return out;
  }

  return { open, tick, get: load, list: () => ids().map((i) => load(i)!).filter(Boolean) };
}

export type Driver = ReturnType<typeof createDriver>;

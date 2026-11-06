import { createServer, type Server } from 'node:http';
import { safeMessage, type EntityWriter, type TrustWriter } from '@lookout/arkiv';
import type { Escrow } from '@lookout/escrow';
import { addEvents, lastCheckpoint, runCheckpoint } from './checkpoint-job.ts';
import type { Journal } from './journal.ts';
import { mirrorDeposits, mirrorSettlements } from './mirror.ts';
import { listDisputes, planReports, type AttestationRow, type Dispute, type PlanPorts, type ReportRow } from './reports.ts';
import { allStatuses, resolveAll, type ReportStatus, type ResolverDeps } from './resolver.ts';

/**
 * The operator service: one pass does everything, in order, and each part may fail without stopping the others (a flaky RPC must
 * not stop the checkpoint, and one bad report must not stop the rest).
 *
 *   1. mirror      escrow deposits and settlements -> Arkiv `stake` entities
 *   2. resolve     every report with a locked deposit: confirm, refund or keep waiting (core/resolution.ts)
 *   3. disputes    owner disputes with a valid proof, waiting for an operator ruling
 *   4. checkpoint  reputation (with the verified-human floor), when due
 *
 * Run `tick()` on a timer. Every step is idempotent, so running it more often than needed, or after a crash, is safe.
 */

export interface ServiceDeps {
  journal: Journal;
  resolver: ResolverDeps;
  source: { reports(): Promise<ReportRow[]>; attestations(): Promise<AttestationRow[]> };
  planPorts: PlanPorts;
  escrow: Pick<Escrow, 'depositEvents' | 'settledEvents'>;
  /** the block the escrow was deployed at, where scanning starts */
  escrowFromBlock: bigint;
  latestEscrowBlock: () => Promise<bigint>;
  arkiv: EntityWriter & TrustWriter;
  now: () => number;
  /** publish a reputation checkpoint at most this often, in seconds */
  checkpointEverySeconds: number;
  humans: () => ReadonlySet<string>;
  /** see MirrorDeps.findStakes */
  findStakes?: (reportId: string) => Promise<string[]>;
}

export interface TickReport {
  mirrored?: { deposits: number; settlements: number; waiting: number };
  resolved?: { waiting: number; confirmed: number; refunded: number; skipped: { key: string; reason: string }[] };
  disputes?: number;
  checkpoint?: { snapshotId: string; people: number };
  errors: { part: string; message: string }[];
}

const CURSOR = 'service:escrow-cursor';
const LAST_CHECKPOINT = 'service:last-checkpoint-at';
const DISPUTES = 'service:disputes';

export function createOperatorService(deps: ServiceDeps) {
  const { journal } = deps;

  /**
   * One pass at a time. A pass talks to two chains and can take longer than the timer that starts it, and two overlapping passes both
   * see the same deposit as "not mirrored yet" and each write it. If a pass is still running, a new call joins it instead of starting another.
   */
  let running: Promise<TickReport> | null = null;
  const tick = (): Promise<TickReport> => (running ??= onePass().finally(() => { running = null; }));

  async function onePass(): Promise<TickReport> {
    const out: TickReport = { errors: [] };

    try {
      const from = BigInt(journal.detail(CURSOR) ?? deps.escrowFromBlock.toString());
      const latest = await deps.latestEscrowBlock();
      if (latest >= from) {
        const [deposits, settled] = [await deps.escrow.depositEvents(from, latest), await deps.escrow.settledEvents(from, latest)];
        const d = await mirrorDeposits({ arkiv: deps.arkiv, journal, findStakes: deps.findStakes, now: deps.now }, deposits);
        const s = await mirrorSettlements({ arkiv: deps.arkiv, journal, findStakes: deps.findStakes }, settled);
        // only move on once nothing is waiting for its deposit to be mirrored: events are never skipped, only re-read
        if (s.unknown === 0 && d.deferred === 0) journal.mark(CURSOR, (latest + 1n).toString());
        out.mirrored = { deposits: d.created, settlements: s.updated, waiting: s.unknown + d.deferred };
      }
    } catch (e) {
      out.errors.push({ part: 'mirror', message: safeMessage(e) });
    }

    try {
      const plan = await planReports(await deps.source.reports(), deps.planPorts);
      const r = await resolveAll(deps.resolver, plan.reports);
      addEvents(journal, r.repEvents);
      for (const e of r.errors) out.errors.push({ part: `report ${e.reportId.slice(0, 8)}`, message: safeMessage(e.message) });
      out.resolved = {
        waiting: r.statuses.filter((s) => s.state === 'waiting').length, confirmed: r.statuses.filter((s) => s.state === 'confirmed').length,
        refunded: r.statuses.filter((s) => s.state === 'refunded').length, skipped: plan.skipped,
      };
    } catch (e) {
      out.errors.push({ part: 'resolve', message: safeMessage(e) });
    }

    try {
      const { disputes } = listDisputes(await deps.source.attestations());
      journal.mark(DISPUTES, JSON.stringify(disputes));
      out.disputes = disputes.length;
    } catch (e) {
      out.errors.push({ part: 'disputes', message: safeMessage(e) });
    }

    try {
      const last = Number(journal.detail(LAST_CHECKPOINT) ?? 0);
      const pending = (JSON.parse(journal.detail('checkpoint:events') ?? '[]') as unknown[]).length > 0;
      if (deps.now() - last >= deps.checkpointEverySeconds && (last === 0 || pending)) {
        const r = await runCheckpoint({ arkiv: deps.arkiv, journal, now: deps.now, humans: deps.humans });
        journal.mark(LAST_CHECKPOINT, String(deps.now()));
        out.checkpoint = { snapshotId: r.snapshotId, people: r.people };
      }
    } catch (e) {
      out.errors.push({ part: 'checkpoint', message: safeMessage(e) });
    }

    return out;
  }

  return {
    tick,
    reports: (): ReportStatus[] => allStatuses(journal),
    disputes: (): Dispute[] => JSON.parse(journal.detail(DISPUTES) ?? '[]') as Dispute[],
    reputation: () => lastCheckpoint(journal),
  };
}

export type OperatorService = ReturnType<typeof createOperatorService>;

/**
 * A small read-only HTTP API for the app: how each report stands, and which owner disputes await a ruling. Everything in it is
 * already public on Arkiv or derivable from it. No write endpoint exists, and no secret is in any response (the reporter's opened
 * bounty address is never included).
 */
export function createOperatorApi(service: OperatorService, opts: { allowOrigin?: string } = {}): Server {
  const allow = opts.allowOrigin ?? '*';
  return createServer((req, res) => {
    const headers = { 'content-type': 'application/json', 'access-control-allow-origin': allow, 'cache-control': 'no-store' };
    const send = (code: number, body: unknown) => { res.writeHead(code, headers); res.end(JSON.stringify(body)); };
    if (req.method === 'OPTIONS') { res.writeHead(204, { ...headers, 'access-control-allow-methods': 'GET' }); return res.end(); }
    if (req.method !== 'GET') return send(405, { error: 'read only' });

    const url = new URL(req.url ?? '/', 'http://localhost');
    if (url.pathname === '/reports') {
      const id = url.searchParams.get('reportId');
      if (id !== null && !/^[0-9a-f]{32}$/.test(id)) return send(400, { error: 'reportId must be 32 lowercase hex digits' });
      return send(200, { reports: id ? service.reports().filter((r) => r.reportId === id) : service.reports() });
    }
    if (url.pathname === '/disputes') return send(200, { disputes: service.disputes() });
    if (url.pathname === '/status') {
      const r = service.reports();
      return send(200, { ok: true, reports: r.length, waiting: r.filter((x) => x.state === 'waiting').length, disputes: service.disputes().length });
    }
    return send(404, { error: 'not found' });
  });
}

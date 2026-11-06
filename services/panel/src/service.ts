import { createServer, type Server } from 'node:http';
import { safeMessage, type EntityWriter, type TrustWriter } from '@lookout/arkiv';
import type { Escrow } from '@lookout/escrow';
import { planCases, type AttestationRow, type PlanPorts, type ReportRow } from './cases.ts';
import { addEvents, lastCheckpoint, runCheckpoint } from './checkpoint-job.ts';
import type { CaseState, Driver } from './driver.ts';
import type { Journal } from './journal.ts';
import { mirrorDeposits, mirrorSettlements } from './mirror.ts';

/**
 * The panel service: one pass does everything the trust layer needs, in order, and each part is allowed to fail without
 * stopping the others (a flaky RPC must not freeze voting, and a stuck case must not stop the checkpoint).
 *
 *   1. mirror      escrow deposits and settlements -> Arkiv `stake` entities
 *   2. open        new cases from reports (locked deposit) and owner disputes (valid proof)
 *   3. advance     every open case: seed, commit round, reveal round, ruling, settlement
 *   4. checkpoint  reputation, when it is due
 *
 * Run `tick()` on a timer. Every step is idempotent, so running it more often than needed, or after a crash, is safe.
 */

export interface ServiceDeps {
  journal: Journal;
  driver: Driver;
  caseSource: { reports(): Promise<ReportRow[]>; attestations(): Promise<AttestationRow[]> };
  planPorts: PlanPorts;
  escrow: Pick<Escrow, 'depositEvents' | 'settledEvents'>;
  /** the block the escrow was deployed at, where scanning starts */
  escrowFromBlock: bigint;
  latestEscrowBlock: () => Promise<bigint>;
  arkiv: EntityWriter & TrustWriter;
  now: () => number;
  /** publish a reputation checkpoint at most this often, in seconds */
  checkpointEverySeconds: number;
}

export interface TickReport {
  mirrored?: { deposits: number; settlements: number; waiting: number };
  opened?: { total: number; new: number; skipped: { key: string; reason: string }[] };
  cases?: { id: string; phase: string; error?: string }[];
  checkpoint?: { snapshotId: string; people: number };
  errors: { part: string; message: string }[];
}

const CURSOR = 'service:escrow-cursor';
const LAST_CHECKPOINT = 'service:last-checkpoint-at';

export function createPanelService(deps: ServiceDeps) {
  const { journal, driver } = deps;
  const msg = safeMessage;

  async function tick(): Promise<TickReport> {
    const out: TickReport = { errors: [] };

    // 1. mirror escrow state into Arkiv
    try {
      const from = BigInt(journal.detail(CURSOR) ?? deps.escrowFromBlock.toString());
      const latest = await deps.latestEscrowBlock();
      if (latest >= from) {
        const [deposits, settled] = [await deps.escrow.depositEvents(from, latest), await deps.escrow.settledEvents(from, latest)];
        const d = await mirrorDeposits({ arkiv: deps.arkiv, journal }, deposits);
        const s = await mirrorSettlements({ arkiv: deps.arkiv, journal }, settled);
        // only move on once nothing is waiting for its deposit to be mirrored: events are never skipped, only re-read
        if (s.unknown === 0) journal.mark(CURSOR, (latest + 1n).toString());
        out.mirrored = { deposits: d.created, settlements: s.updated, waiting: s.unknown };
      }
    } catch (e) {
      out.errors.push({ part: 'mirror', message: msg(e) });
    }

    // 2. open new cases
    try {
      const [reports, attestations] = [await deps.caseSource.reports(), await deps.caseSource.attestations()];
      const plan = await planCases({ reports, attestations }, deps.planPorts);
      const known = new Set(driver.list().map((c) => c.request.caseId));
      let fresh = 0;
      for (const r of plan.requests) {
        if (!known.has(r.caseId)) fresh++;
        await driver.open(r);
      }
      out.opened = { total: plan.requests.length, new: fresh, skipped: plan.skipped };
    } catch (e) {
      out.errors.push({ part: 'open', message: msg(e) });
    }

    // 3. advance every case
    try {
      out.cases = await driver.tick();
      for (const c of out.cases) if (c.error) out.errors.push({ part: `case ${c.id}`, message: c.error });
    } catch (e) {
      out.errors.push({ part: 'advance', message: msg(e) });
    }

    // 4. reputation checkpoint when due
    try {
      const last = Number(journal.detail(LAST_CHECKPOINT) ?? 0);
      if (deps.now() - last >= deps.checkpointEverySeconds && (last === 0 || hasPendingEvents(journal))) {
        const r = await runCheckpoint({ arkiv: deps.arkiv, journal, now: deps.now });
        journal.mark(LAST_CHECKPOINT, String(deps.now()));
        out.checkpoint = { snapshotId: r.snapshotId, people: r.people };
      }
    } catch (e) {
      out.errors.push({ part: 'checkpoint', message: msg(e) });
    }

    return out;
  }

  return { tick, cases: () => driver.list(), reputation: () => lastCheckpoint(journal) };
}

export type PanelService = ReturnType<typeof createPanelService>;

const hasPendingEvents = (j: Journal) => (JSON.parse(j.detail('checkpoint:events') ?? '[]') as unknown[]).length > 0;

/** Records reputation events from a settled case, for the next checkpoint. Wire this into the driver's settle port. */
export const recordRepEvents = addEvents;

/* ----------------------------------- API ----------------------------------- */

/** What the public API says about a case. The reporter's opened bounty address is NEVER included. */
export function publicCase(s: CaseState) {
  const r = s.request;
  return {
    caseId: r.caseId, type: r.type ?? 'report', target: { kind: r.kind, value: r.value }, reportId: r.reportId || null,
    phase: s.phase, round: s.round, openedBlock: s.openedBlock, seed: s.seed ?? null, jurors: s.jurors ?? [],
    commitEnd: s.commitEnd ?? null, revealEnd: s.revealEnd ?? null, note: s.note ?? null, result: s.result ?? null,
  };
}

/**
 * A small read-only HTTP API for the app: which cases exist, and which one a reviewer has been drawn for. All of it is
 * already public on Arkiv or derivable from it. No write endpoint exists, and there is no secret in any response.
 */
export function createPanelApi(service: PanelService, opts: { allowOrigin?: string } = {}): Server {
  const allow = opts.allowOrigin ?? '*';
  return createServer((req, res) => {
    const headers = { 'content-type': 'application/json', 'access-control-allow-origin': allow, 'cache-control': 'no-store' };
    const send = (code: number, body: unknown) => { res.writeHead(code, headers); res.end(JSON.stringify(body)); };
    if (req.method === 'OPTIONS') { res.writeHead(204, { ...headers, 'access-control-allow-methods': 'GET' }); return res.end(); }
    if (req.method !== 'GET') return send(405, { error: 'read only' });

    const url = new URL(req.url ?? '/', 'http://localhost');
    const all = service.cases().map(publicCase);
    if (url.pathname === '/cases') {
      const juror = url.searchParams.get('juror')?.toLowerCase();
      if (juror !== undefined && !/^0x[0-9a-f]{40}$/.test(juror)) return send(400, { error: 'juror must be a 0x address' });
      return send(200, { cases: juror ? all.filter((c) => c.jurors.includes(juror)) : all });
    }
    const m = url.pathname.match(/^\/cases\/([0-9a-f]{16})$/);
    if (m) {
      const c = all.find((x) => x.caseId === m[1]);
      return c ? send(200, c) : send(404, { error: 'no such case' });
    }
    if (url.pathname === '/status') return send(200, { ok: true, cases: all.length, open: all.filter((c) => c.phase !== 'settled' && c.phase !== 'unresolved').length });
    return send(404, { error: 'not found' });
  });
}

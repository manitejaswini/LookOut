import { normalizeTarget, targetHash } from './target.ts';
import type { TargetKind } from './types.ts';

/**
 * What a `report` entity carries in its `payload` bytes:
 *
 *   { "v": 0, "k": "domain" | "address" | "contract", "t": "<the target in plain text>" }
 *
 * The plain target is there so the review panel can rule on it: the entity itself only carries the target's HASH. It is public,
 * the same as the report that names it, and the panel CHECKS that it hashes to the entity's `targetHash`, so a report cannot
 * smuggle in a different target than the one it was indexed under.
 */

export const REPORT_PAYLOAD_VERSION = 0;
export const MAX_REPORT_PAYLOAD_BYTES = 1024;

export interface ReportPayload {
  kind: TargetKind;
  /** the normalized target */
  target: string;
}

const KINDS: readonly string[] = ['domain', 'address', 'contract'];

export function encodeReportPayload(input: { kind: TargetKind; value: string }): Uint8Array {
  const target = normalizeTarget(input.kind, input.value); // throws on junk
  const body: Record<string, unknown> = { v: REPORT_PAYLOAD_VERSION, k: input.kind, t: target };
  const bytes = new TextEncoder().encode(JSON.stringify(body));
  if (bytes.length > MAX_REPORT_PAYLOAD_BYTES) throw new Error('report payload is too large');
  return bytes;
}

export type DecodedReport = { ok: true; payload: ReportPayload } | { ok: false; reason: string };

/** Reads a payload and checks it against the hash the report was indexed under. Never throws. */
export function decodeReportPayload(bytes: Uint8Array | undefined, expectedTargetHash: string): DecodedReport {
  if (!bytes || bytes.length === 0) return { ok: false, reason: 'the report has no payload' };
  if (bytes.length > MAX_REPORT_PAYLOAD_BYTES) return { ok: false, reason: 'payload too large' };
  let j: unknown;
  try {
    j = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    return { ok: false, reason: 'payload is not JSON' };
  }
  const o = (typeof j === 'object' && j !== null ? j : {}) as Record<string, unknown>;
  if (o.v !== REPORT_PAYLOAD_VERSION) return { ok: false, reason: 'unknown payload version' };
  if (typeof o.k !== 'string' || !KINDS.includes(o.k)) return { ok: false, reason: 'bad target kind' };
  if (typeof o.t !== 'string') return { ok: false, reason: 'no target' };
  const kind = o.k as TargetKind;
  let target: string;
  try {
    target = normalizeTarget(kind, o.t);
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : 'bad target' };
  }
  if (targetHash(kind, target) !== expectedTargetHash.toLowerCase()) return { ok: false, reason: 'the target in the payload does not match the report' };
  return { ok: true, payload: { kind, target } };
}

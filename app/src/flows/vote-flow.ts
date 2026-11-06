import { commitVote, newSalt, verifyReveal, VOTE_OUTCOMES, type VoteOutcome } from '@lookout/core';

/**
 * A juror's vote: commit now, reveal later. The salt is the secret that makes the reveal possible, and it lives only on
 * this device. It is saved BEFORE the commitment is sent, so a crash between the two cannot leave a commitment that no
 * one can open. A second commit for the same case is refused, so a saved salt can never be overwritten.
 */

export interface VoteStorage {
  get(key: string): string | null;
  set(key: string, value: string): void;
}

export interface SavedVote {
  caseId: string;
  juror: string;
  outcome: VoteOutcome;
  salt: string;
  commitHash: string;
  /** the Arkiv vote entity, known once the commitment was published */
  entityKey?: string;
  revealed: boolean;
}

export interface VotePorts {
  storage: VoteStorage;
  createVote(input: { caseId: string; commitHash: string }): Promise<{ entityKey: string }>;
  revealVote(input: { entityKey: string; caseId: string; juror: string; outcome: VoteOutcome; salt: string; commitHash: string }): Promise<void>;
}

export class VoteError extends Error {
  code: 'bad-input' | 'already-committed' | 'nothing-saved' | 'not-published' | 'already-revealed' | 'mismatch';
  constructor(code: VoteError['code'], message: string) {
    super(message);
    this.name = 'VoteError';
    this.code = code;
  }
}

const slot = (caseId: string, juror: string) => `lookout.vote.v0:${caseId}:${juror.toLowerCase()}`;

export const savedVote = (storage: VoteStorage, caseId: string, juror: string): SavedVote | null => {
  const raw = storage.get(slot(caseId, juror));
  return raw ? (JSON.parse(raw) as SavedVote) : null;
};

export async function commit(ports: VotePorts, a: { caseId: string; juror: string; outcome: VoteOutcome }): Promise<SavedVote> {
  if (!/^[0-9a-f]{16}$/.test(a.caseId)) throw new VoteError('bad-input', 'a case id is 16 lowercase hex digits');
  if (!(VOTE_OUTCOMES as readonly string[]).includes(a.outcome)) throw new VoteError('bad-input', 'vote block or clear');
  const existing = savedVote(ports.storage, a.caseId, a.juror);
  if (existing) {
    // a commitment that was saved but never published may be retried with the SAME salt. A published one is final.
    if (existing.entityKey) throw new VoteError('already-committed', 'you already voted in this case. You cannot change it.');
    if (existing.outcome !== a.outcome) throw new VoteError('already-committed', `a ${existing.outcome} vote is saved on this device and waiting to be sent. Send that one.`);
  }
  const saved: SavedVote = existing ?? {
    caseId: a.caseId, juror: a.juror.toLowerCase(), outcome: a.outcome, salt: newSalt(), revealed: false,
    commitHash: '',
  };
  saved.commitHash = commitVote({ caseId: saved.caseId, outcome: saved.outcome, salt: saved.salt, juror: saved.juror });
  ports.storage.set(slot(a.caseId, a.juror), JSON.stringify(saved)); // saved first
  const out = await ports.createVote({ caseId: saved.caseId, commitHash: saved.commitHash });
  saved.entityKey = out.entityKey;
  ports.storage.set(slot(a.caseId, a.juror), JSON.stringify(saved));
  return saved;
}

export async function reveal(ports: VotePorts, a: { caseId: string; juror: string }): Promise<SavedVote> {
  const saved = savedVote(ports.storage, a.caseId, a.juror);
  if (!saved) throw new VoteError('nothing-saved', 'this device has no saved vote for this case. The salt exists only where you voted.');
  if (saved.revealed) throw new VoteError('already-revealed', 'you already revealed this vote');
  if (!saved.entityKey) throw new VoteError('not-published', 'your commitment was never sent. Send it first (and only during the commit round).');
  if (!verifyReveal(saved.commitHash, { caseId: saved.caseId, outcome: saved.outcome, salt: saved.salt, juror: saved.juror })) {
    throw new VoteError('mismatch', 'the saved vote no longer matches its commitment, it would be ignored');
  }
  await ports.revealVote({ entityKey: saved.entityKey, caseId: saved.caseId, juror: saved.juror, outcome: saved.outcome, salt: saved.salt, commitHash: saved.commitHash });
  saved.revealed = true;
  ports.storage.set(slot(a.caseId, a.juror), JSON.stringify(saved));
  return saved;
}

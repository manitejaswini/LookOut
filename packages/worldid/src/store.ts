import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

/**
 * The reviewer seat registry: who holds a seat, and which anonymous human nullifier it belongs to.
 *
 * Privacy: it stores the action-scoped nullifier (unlinkable to the same person in any other app) and the wallet.
 * It never stores a name, an iris code, or anything else about the person. The public API never returns nullifiers.
 *
 * "One human, one seat" is enforced by the database, not by hope: UNIQUE(nullifier, action) stops one human taking two
 * seats with two wallets, and UNIQUE(wallet, action) stops two humans sharing one wallet.
 */

export type EnrollOutcome =
  | 'enrolled' // a new seat
  | 'already_seated' // this human already holds this very seat (a harmless retry)
  | 'human_already_enrolled' // this human already holds a seat with a DIFFERENT wallet
  | 'wallet_taken'; // this wallet already belongs to a DIFFERENT human

export interface SeatStore {
  enroll(nullifier: string, wallet: string, action: string): EnrollOutcome;
  hasSeat(wallet: string, action: string): boolean;
  count(action: string): number;
  /** lowercase wallet addresses holding a seat, oldest first. The panel service draws jurors from this pool */
  wallets(action: string): string[];
  /** every seat with the nullifier that earned it. One nullifier and one wallet per seat, enforced by the store */
  seats(action: string): { wallet: string; nullifier: string }[];
  close(): void;
}

export class SqliteSeatStore implements SeatStore {
  private db: DatabaseSync;
  private now: () => number;

  constructor(path = ':memory:', now: () => number = () => Math.floor(Date.now() / 1000)) {
    this.now = now;
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS seats (
        nullifier   TEXT NOT NULL,
        wallet      TEXT NOT NULL,
        action      TEXT NOT NULL,
        enrolled_at INTEGER NOT NULL,
        UNIQUE (nullifier, action),
        UNIQUE (wallet, action)
      );
    `);
  }

  enroll(nullifier: string, wallet: string, action: string): EnrollOutcome {
    // IMMEDIATE takes the write lock up front, so two simultaneous requests cannot both pass the checks below
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const byHuman = this.db.prepare('SELECT wallet FROM seats WHERE nullifier = ? AND action = ?').get(nullifier, action) as { wallet: string } | undefined;
      if (byHuman) {
        this.db.exec('COMMIT');
        return byHuman.wallet === wallet ? 'already_seated' : 'human_already_enrolled';
      }
      const byWallet = this.db.prepare('SELECT 1 AS x FROM seats WHERE wallet = ? AND action = ?').get(wallet, action);
      if (byWallet) {
        this.db.exec('COMMIT');
        return 'wallet_taken';
      }
      this.db.prepare('INSERT INTO seats (nullifier, wallet, action, enrolled_at) VALUES (?, ?, ?, ?)').run(nullifier, wallet, action, this.now());
      this.db.exec('COMMIT');
      return 'enrolled';
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
  }

  hasSeat(wallet: string, action: string): boolean {
    return !!this.db.prepare('SELECT 1 AS x FROM seats WHERE wallet = ? AND action = ?').get(wallet, action);
  }

  count(action: string): number {
    return Number((this.db.prepare('SELECT COUNT(*) AS n FROM seats WHERE action = ?').get(action) as { n: number | bigint }).n);
  }

  wallets(action: string): string[] {
    return (this.db.prepare('SELECT wallet FROM seats WHERE action = ? ORDER BY enrolled_at, rowid').all(action) as { wallet: string }[]).map((r) => r.wallet);
  }

  seats(action: string): { wallet: string; nullifier: string }[] {
    return (this.db.prepare('SELECT wallet, nullifier FROM seats WHERE action = ? ORDER BY enrolled_at, rowid').all(action) as { wallet: string; nullifier: string }[]).map((r) => ({ wallet: r.wallet, nullifier: r.nullifier }));
  }

  close(): void {
    this.db.close();
  }
}

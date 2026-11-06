import { DatabaseSync } from 'node:sqlite';

/**
 * A record of which settlement steps are already done. Settlement touches money and public records, and any step can fail
 * halfway (network, gas). The journal makes the whole thing safe to re-run: a step that is marked done is never repeated.
 */
export interface Journal {
  has(key: string): boolean;
  mark(key: string, detail?: string): void;
  detail(key: string): string | undefined;
}

export function memoryJournal(): Journal {
  const m = new Map<string, string>();
  return { has: (k) => m.has(k), mark: (k, d = '') => void m.set(k, d), detail: (k) => m.get(k) };
}

export function sqliteJournal(path: string): Journal {
  const db = new DatabaseSync(path);
  db.exec('CREATE TABLE IF NOT EXISTS journal (key TEXT PRIMARY KEY, detail TEXT NOT NULL, at INTEGER NOT NULL)');
  const get = db.prepare('SELECT detail FROM journal WHERE key = ?');
  const put = db.prepare('INSERT OR REPLACE INTO journal (key, detail, at) VALUES (?, ?, ?)');
  return {
    has: (k) => get.get(k) !== undefined,
    mark: (k, d = '') => void put.run(k, d, Math.floor(Date.now() / 1000)),
    detail: (k) => (get.get(k) as { detail: string } | undefined)?.detail,
  };
}

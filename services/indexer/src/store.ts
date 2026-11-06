import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { BlockTiming, IndexedKind, RawRow, StoredEntity } from './types.ts';

/**
 * Where the cache lives unless INDEXER_DB says otherwise: OUTSIDE the repository. The cache is rewritten on every sync
 * (every 30 s under `indexer:serve`), and a dev server that watches the repo sees each write as a code change and reloads
 * the page over and over. It is also machine-local data that has no business inside the project folder.
 */
export const defaultDbPath = (): string => join(process.env.LOOKOUT_DATA_DIR ?? join(homedir(), '.lookout'), 'indexer', 'index.sqlite');

/**
 * A local SQLite cache of what the indexer read from Arkiv. It is derived data: delete the file and the
 * next sync rebuilds it from Arkiv alone, which is exactly the "wipe our servers and rebuild" story.
 */
export class Store {
  private db: DatabaseSync;

  constructor(path = ':memory:') {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS entities (
        key           TEXT PRIMARY KEY,
        kind          TEXT NOT NULL,
        creator       TEXT NOT NULL,
        owner         TEXT NOT NULL,
        created_block INTEGER NOT NULL,
        expires_block INTEGER NOT NULL,
        target_hash   TEXT,
        attrs         TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS entities_target ON entities (target_hash, kind);
      CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT NOT NULL);
    `);
  }

  /** Replaces everything in one transaction. A failed sync leaves the previous data untouched. */
  replaceAll(rows: { kind: IndexedKind; row: RawRow }[], timing: BlockTiming, epoch?: BlockTiming): void {
    this.db.exec('BEGIN');
    try {
      this.db.exec('DELETE FROM entities');
      const insert = this.db.prepare(
        'INSERT INTO entities (key, kind, creator, owner, created_block, expires_block, target_hash, attrs) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      );
      for (const { kind, row } of rows) {
        insert.run(row.key, kind, row.creator, row.owner, row.createdBlock, row.expiresBlock, row.attrs.targetHash ?? null, JSON.stringify(row.attrs));
      }
      const setMeta = this.db.prepare('INSERT INTO meta (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v');
      setMeta.run('timing', JSON.stringify(timing));
      if (epoch) setMeta.run('epoch', JSON.stringify(epoch));
      setMeta.run('syncedAt', String(Date.now()));
      this.db.exec('COMMIT');
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
  }

  entities(): StoredEntity[] {
    const rows = this.db.prepare('SELECT * FROM entities ORDER BY key').all() as Record<string, unknown>[];
    return rows.map((r) => ({
      key: String(r.key),
      kind: r.kind as IndexedKind,
      creator: String(r.creator),
      owner: String(r.owner),
      createdBlock: Number(r.created_block),
      expiresBlock: Number(r.expires_block),
      attrs: JSON.parse(String(r.attrs)) as Record<string, string>,
    }));
  }

  timing(): BlockTiming | null {
    const r = this.db.prepare("SELECT v FROM meta WHERE k = 'timing'").get() as { v: string } | undefined;
    return r ? (JSON.parse(r.v) as BlockTiming) : null;
  }

  /** The epoch block this cache was synced into, with its exact chain timestamp. Null for caches from before epochs. */
  epoch(): BlockTiming | null {
    const r = this.db.prepare("SELECT v FROM meta WHERE k = 'epoch'").get() as { v: string } | undefined;
    return r ? (JSON.parse(r.v) as BlockTiming) : null;
  }

  syncedAt(): number | null {
    const r = this.db.prepare("SELECT v FROM meta WHERE k = 'syncedAt'").get() as { v: string } | undefined;
    return r ? Number(r.v) : null;
  }

  count(): number {
    return Number((this.db.prepare('SELECT COUNT(*) AS n FROM entities').get() as { n: number | bigint }).n);
  }

  close(): void {
    this.db.close();
  }
}

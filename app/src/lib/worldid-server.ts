import path from 'node:path';
import { defaultDeps, SqliteSeatStore, type HandlerDeps } from '@lookout/worldid';

/**
 * Server-only wiring for the World ID routes. The seat database is a file under app/.data (gitignored), or
 * WORLDID_DB if set. It is opened on first use and kept for the life of the server process.
 */
let store: SqliteSeatStore | undefined;
let deps: HandlerDeps | undefined;

const getStore = () => (store ??= new SqliteSeatStore(process.env.WORLDID_DB ?? path.join(process.cwd(), '.data', 'worldid.sqlite')));

export const worldIdDeps = (): HandlerDeps => (deps ??= defaultDeps({ store: getStore }));

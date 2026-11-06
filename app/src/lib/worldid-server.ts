import os from 'node:os';
import path from 'node:path';
import { defaultDeps, SqliteSeatStore, type HandlerDeps } from '@lookout/worldid';

/**
 * Server-only wiring for the World ID routes. The seat database is ~/.lookout/worldid/worldid.sqlite (or WORLDID_DB, or under LOOKOUT_DATA_DIR),
 * OUTSIDE the repository: the panel service reads the same file to know who may be drawn as a juror, and a file inside the project
 * folder would make the dev server reload whenever it changes. It is opened on first use and kept for the life of the server process.
 */
let store: SqliteSeatStore | undefined;
let deps: HandlerDeps | undefined;

const getStore = () => (store ??= new SqliteSeatStore(process.env.WORLDID_DB ?? path.join(process.env.LOOKOUT_DATA_DIR ?? path.join(os.homedir(), '.lookout'), 'worldid', 'worldid.sqlite')));

export const worldIdDeps = (): HandlerDeps => (deps ??= defaultDeps({ store: getStore }));

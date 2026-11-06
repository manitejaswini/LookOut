import { handleVerify } from '@lookout/worldid';
import { worldIdDeps } from '../../../../lib/worldid-server';

// uses node:sqlite and process.env, so it must run on the Node runtime and never be cached
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = (req: Request) => handleVerify(req, worldIdDeps());

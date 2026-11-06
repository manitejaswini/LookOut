// node src/cli.ts --dir ./data --port 8801 --name A
import { loadSnapshots } from './store.ts';
import { createPirServer } from './server.ts';

const arg = (flag: string, fallback?: string) => {
  const i = process.argv.indexOf(flag);
  return i > -1 ? process.argv[i + 1] : fallback;
};
const dir = arg('--dir');
if (!dir) { console.error('usage: node src/cli.ts --dir <snapshot dir> [--port 8801] [--name A]'); process.exit(2); }
const { snapshots, latest } = loadSnapshots(dir);
const port = Number(arg('--port', '8801'));
const name = arg('--name', 'A')!;
createPirServer({ name, snapshots, latest }).listen(port, () => {
  console.log(`PIR server ${name} on http://localhost:${port}, snapshot ${latest}, root ${snapshots.get(latest)!.root}`);
});

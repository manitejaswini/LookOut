// Starts two PIR servers on one machine with the demo snapshot: `npm run demo -w @lookout/pir-server`
// Two ports on one host is for local demos only. The privacy claim needs two independent operators.
import { createPirServer } from './server.ts';
import { buildDemoSnapshot } from './demo-snapshot.ts';

const snap = buildDemoSnapshot();
const id = snap.snapshotId;
for (const [name, port] of [['A', 8801], ['B', 8802]] as const) {
  createPirServer({ name, snapshots: new Map([[id, snap]]), latest: id }).listen(port, () => console.log(`PIR server ${name}: http://localhost:${port}`));
}
console.log(`snapshot ${id}, root ${snap.root}, ${snap.bucketCount} buckets`);
console.log('Each query is logged below as a snapshot id, a vector length and a short vector hash. The target never reaches either server.');

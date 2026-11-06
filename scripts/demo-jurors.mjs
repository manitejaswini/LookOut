// DEMO ONLY. Creates throwaway juror wallets so a panel of three can be shown in a recording.
//
// These jurors have FAKE seats: they skip World ID, which is the whole point of the seat pool. Never use this against a real
// deployment. The wallets hold testnet funds only, and their keys are stored in ~/.lookout/demo-jurors.json (outside the repo).
//
//   node scripts/demo-jurors.mjs setup --i-know-these-are-fake-seats [--count 3]   create, fund, stake and seat them
//   node scripts/demo-jurors.mjs list                                              addresses and balances
//   node scripts/demo-jurors.mjs vote   --case <caseId> --votes block,block,clear  commit hidden votes (one per juror, in order)
//   node scripts/demo-jurors.mjs reveal --case <caseId>                            reveal what they committed
//
// Funding comes from the wallet in .env (ARKIV_PRIVATE_KEY): Sepolia ETH for the stake and gas, tGLM for Arkiv gas.
import './safe-errors.mjs';

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { createPublicClient, createWalletClient, formatEther, http, parseEther } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { sepolia } from 'viem/chains';
import { commitVote, CONFIG, newSalt } from '@lookout/core';
import { createArkivClients, createVote, revealVote } from '@lookout/arkiv';
import { createEscrow } from '@lookout/escrow';
import { SqliteSeatStore, REVIEWER_ACTION } from '@lookout/worldid';

const envPath = new URL('../.env', import.meta.url);
if (existsSync(envPath)) process.loadEnvFile(envPath);
const { ARKIV_ACCESS_KEY, ARKIV_PRIVATE_KEY, ESCROW_ADDRESS, ESCROW_RPC_URL } = process.env;
if (!ARKIV_ACCESS_KEY || !ARKIV_PRIVATE_KEY || !ESCROW_ADDRESS) { console.error('Need ARKIV_ACCESS_KEY, ARKIV_PRIVATE_KEY and ESCROW_ADDRESS in .env'); process.exit(1); }

const dataDir = process.env.LOOKOUT_DATA_DIR ?? join(homedir(), '.lookout');
const file = join(dataDir, 'demo-jurors.json');
const arg = (f, d) => { const i = process.argv.indexOf(f); return i > -1 ? process.argv[i + 1] : d; };
const [cmd] = process.argv.slice(2);
const load = () => (existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : { jurors: [], votes: {} });
const save = (s) => { mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, JSON.stringify(s, null, 2)); };

const transport = http(ESCROW_RPC_URL || 'https://ethereum-sepolia-rpc.publicnode.com', { retryCount: 8, retryDelay: 1500 });
const sep = createPublicClient({ chain: sepolia, transport });
const funder = createArkivClients({ accessKey: ARKIV_ACCESS_KEY, privateKey: ARKIV_PRIVATE_KEY });
const funderSepolia = createWalletClient({ account: privateKeyToAccount(ARKIV_PRIVATE_KEY), chain: sepolia, transport });
const stake = parseEther(String(CONFIG.REVIEWER_STAKE_ETH));

const escrowAs = (key) => createEscrow({ address: ESCROW_ADDRESS, publicClient: sep, walletClient: createWalletClient({ account: privateKeyToAccount(key), chain: sepolia, transport }) });
const arkivAs = (key) => createArkivClients({ accessKey: ARKIV_ACCESS_KEY, privateKey: key });

if (cmd === 'setup') {
  if (!process.argv.includes('--i-know-these-are-fake-seats')) { console.error('Refusing: these seats bypass World ID. Add --i-know-these-are-fake-seats to confirm this is a demo.'); process.exit(1); }
  const count = Number(arg('--count', '3'));
  const state = load();
  const store = new SqliteSeatStore(process.env.WORLDID_DB ?? join(dataDir, 'worldid', 'worldid.sqlite'));
  while (state.jurors.length < count) state.jurors.push({ key: generatePrivateKey() });
  save(state);
  for (const [i, j] of state.jurors.entries()) {
    const account = privateKeyToAccount(j.key);
    const bal = await sep.getBalance({ address: account.address });
    const want = stake + parseEther('0.0015');
    if (bal < want) {
      const hash = await funderSepolia.sendTransaction({ to: account.address, value: want - bal });
      await sep.waitForTransactionReceipt({ hash });
      console.log(`juror ${i} ${account.address.slice(0, 8)}…: sent ${formatEther(want - bal)} Sepolia ETH`);
    }
    const arkivBal = await funder.publicClient.getBalance({ address: account.address });
    if (arkivBal < parseEther('0.002')) {
      const hash = await funder.walletClient.sendTransaction({ to: account.address, value: parseEther('0.002') - arkivBal });
      await funder.publicClient.waitForTransactionReceipt({ hash });
      console.log(`juror ${i}: sent tGLM for Arkiv gas`);
    }
    const escrow = escrowAs(j.key);
    if (!(await escrow.stakeOf(account.address)).eligible) { await escrow.stake(stake); console.log(`juror ${i}: staked ${formatEther(stake)} ETH`); }
    const outcome = store.enroll(`demo_fake_nullifier_${i}`, account.address.toLowerCase(), REVIEWER_ACTION);
    console.log(`juror ${i}: seat ${outcome} (FAKE, demo only)`);
  }
  store.close();
  console.log(`\n${state.jurors.length} demo jurors ready. Keys are in ${file}`);
} else if (cmd === 'list') {
  for (const [i, j] of load().jurors.entries()) {
    const a = privateKeyToAccount(j.key).address;
    const e = await escrowAs(j.key).stakeOf(a);
    console.log(`juror ${i} ${a}  stake ${formatEther(e.amount)} ETH  eligible ${e.eligible}`);
  }
} else if (cmd === 'vote' || cmd === 'reveal') {
  const caseId = arg('--case');
  if (!/^[0-9a-f]{16}$/.test(caseId ?? '')) { console.error('--case must be a 16 character case id'); process.exit(1); }
  const state = load();
  const plan = (arg('--votes', '') ?? '').split(',').filter(Boolean);
  for (const [i, j] of state.jurors.entries()) {
    const account = privateKeyToAccount(j.key);
    const me = account.address.toLowerCase();
    const slot = `${caseId}:${me}`;
    const client = arkivAs(j.key);
    if (cmd === 'vote') {
      const outcome = plan[i];
      if (!outcome || outcome === 'skip') { console.log(`juror ${i}: not voting`); continue; }
      if (outcome !== 'block' && outcome !== 'clear') { console.error('votes are block, clear or skip'); process.exit(1); }
      if (state.votes[slot]?.entityKey) { console.log(`juror ${i}: already committed`); continue; }
      // a vote saved but never sent (the send failed) is retried with the SAME salt, so nothing is lost
      const salt = state.votes[slot]?.salt ?? newSalt();
      const commitHash = commitVote({ caseId, outcome: state.votes[slot]?.outcome ?? outcome, salt, juror: me });
      state.votes[slot] = { outcome: state.votes[slot]?.outcome ?? outcome, salt, commitHash }; // saved BEFORE sending
      save(state);
      const out = await createVote(client.writer, { caseId, commitHash });
      state.votes[slot].entityKey = out.entityKey;
      save(state);
      console.log(`juror ${i}: committed a hidden vote`);
    } else {
      const v = state.votes[slot];
      if (!v?.entityKey) { console.log(`juror ${i}: nothing to reveal`); continue; }
      if (v.revealed) { console.log(`juror ${i}: already revealed`); continue; }
      await revealVote(client.writer, { entityKey: v.entityKey, caseId, juror: me, outcome: v.outcome, salt: v.salt, commitHash: v.commitHash });
      v.revealed = true;
      save(state);
      console.log(`juror ${i}: revealed ${v.outcome}`);
    }
  }
} else {
  console.error('usage: setup | list | vote --case <id> --votes a,b,c | reveal --case <id>');
  process.exit(1);
}

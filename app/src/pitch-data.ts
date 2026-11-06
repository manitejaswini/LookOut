// Content for the 5-slide pitch deck (src/Deck.tsx). Edit wording here.

export const PITCH_LINE = 'We don’t count wallets, we weigh them.';
export const PITCH_SUB = 'Nobody owns the list, nobody sees your query, and a thousand fresh wallets can’t block a real site.';

export const ONE_LINE =
  'A community-owned scam check for wallets and AI agents. Arkiv holds the shared data, reputation and stake keep it honest, and lookups are private.';

/* slide 2 · problem */
export const PROBLEMS: [string, string][] = [
  ['One company, one list', 'Wallet warnings come from one company’s list. That company sees what you are about to sign, and you have to trust its list.'],
  ['Scams outrun lists', 'Most phishing domains live under about 10 minutes. A list that updates every few hours is always behind.'],
  ['Open reporting is gameable', 'One person with 1,000 wallets can flag a legitimate site, or bury real warnings in noise.'],
  ['Agents sign alone', 'AI agents sign transactions with no human in the loop, and prompt-injection drains are already happening.'],
];

export const SCALE: [string, string, string][] = [
  ['$14B+', 'onchain scams in 2025', 'Chainalysis estimate'],
  ['~$84M', 'lost to drainer phishing in 2025', 'Scam Sniffer'],
  ['106K', 'drainer victims in 2025', 'Scam Sniffer'],
];

/* slide 3 · solution */
export const INTRO =
  'Lookout is a pre-sign safety check for wallets and AI agents. Before anything is signed, it privately answers one question: block, warn or unknown.';

// [title, short caption]
export const WORKFLOW: [string, string][] = [
  ['Report', 'Reporters post with a deposit'],
  ['Arkiv', 'Owned entries that expire'],
  ['Check privately', 'Two PIR servers, verified'],
  ['Verdict', 'Block, warn or unknown'],
];

export const DISPUTE_NOTE = 'Owners can dispute a flag. A reviewer panel rules, and reputation updates.';
export const BLOCK_LINE = 'Block needs 2+ source types, a reviewer ruling, or proof anyone can re-check.';

/* slide 4 · trust + Arkiv */
export const SYBIL: [string, string][] = [
  ['Deposits', 'A rejected report loses its deposit, so fake reports cost money.'],
  ['Reputation', 'Earned when reports are confirmed, lost when rejected, non-transferable, and it decays.'],
  ['Reviewer panel', 'Random staked jurors vote hidden-then-reveal. Jurors on the losing side lose reputation.'],
];

export const ARKIV_KINDS = [
  'report', 'verdict', 'attestation', 'stake', 'vote', 'ruling', 'reputation', 'snapshot', 'bounty',
];

export const WHY_ARKIV: [string, string][] = [
  ['Ownership', 'We cannot edit anyone’s entry.'],
  ['Expiry', 'Scams die fast, so their flags do too.'],
  ['Attribute queries', 'Indexers build the lookup from them.'],
  ['Source of truth', 'Wipe our servers and rebuild from Arkiv.'],
];

/* slide 5 · Ethereum Foundation */
export const CROPS: [string, string][] = [
  ['Censorship resistance', 'No single party can delete or hide a report, and anyone can run an indexer.'],
  ['Open source', 'Everything is public under a FOSS license and rebuilds from Arkiv.'],
  ['Privacy', 'PIR lookups, stealth payouts, and keys and queries that stay on the device.'],
  ['Security', 'Answers are verified against a root on Arkiv, and the anti-Sybil design limits fake reports.'],
];

export const EF_STACK: [string, string, string][] = [
  ['Private lookup', '2-server PIR. Neither server learns which entry you asked for.', 'Core'],
  ['Stealth bounties', 'ERC-5564 style one-time address paid in ETH. No relayer, no gas-funding link.', 'Core'],
  ['Anon-RPC', 'PIR hides what you ask, but an RPC node still sees your IP. Anon-RPC is the EF track for IP-hiding access, so chain and Arkiv reads go through it.', 'Verify support'],
  ['EIP-8141 sweep', 'Sweep the stealth address with a frame transaction on the EF alt-mempool devnet. A draft proposal.', 'Verify support'],
];

export const LIMITS =
  'Said upfront: PIR assumes the two servers do not collude · Anon-RPC and EIP-8141 network support is unverified · first reviewers are seeded · a rich attacker raises the cost, blocking still needs proof or a ruling';

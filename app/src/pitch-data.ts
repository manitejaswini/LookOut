// Content for the two 5-slide pitch decks (src/Deck.tsx, src/deck-slides.tsx).
// /pitch/arkiv is for the Arkiv judges, /pitch/ef is for the Ethereum Foundation judges.

export type Pair = [string, string];
export type Step = [title: string, caption: string, track?: 'arkiv' | 'ef', tag?: string];

/* ---------- shared ---------- */

export const ONE_LINE =
  'A community-owned scam check for wallets and AI agents. Arkiv holds the shared data, reputation and stake keep it honest, and lookups are private.';

export const SCALE: [string, string, string][] = [
  ['$14B+', 'onchain scams in 2025', 'Chainalysis estimate'],
  ['~$84M', 'lost to drainer phishing in 2025', 'Scam Sniffer'],
  ['106K', 'drainer victims in 2025', 'Scam Sniffer'],
];

export const DISPUTE_NOTE = 'Owners can dispute a flag. A reviewer panel rules, and reputation updates.';
export const BLOCK_LINE = 'Block needs 2+ source types, a reviewer ruling, or proof anyone can re-check.';

export const SYBIL: Pair[] = [
  ['Deposits', 'A rejected report loses its deposit, so fake reports cost money.'],
  ['Reputation', 'Earned when reports are confirmed, lost when rejected, non-transferable, and it decays.'],
  ['Reviewer panel', 'Random staked jurors vote hidden-then-reveal. Jurors on the losing side lose reputation.'],
];

export const TRACK_LABEL: Record<string, string> = { arkiv: 'Arkiv', ef: 'EF · CROPS' };

/* ---------- ARKIV deck ---------- */

export const ARKIV = {
  cover: {
    label: 'Lookout · Arkiv: Build from scratch',
    title: ['NO ARKIV,', 'NO LOOKOUT.'],
    lede: 'Scam intel as owned, expiring Arkiv entities. Wipe our servers and rebuild the whole list from Arkiv.',
  },
  problemTitle: 'A scam list nobody owns, and nobody can audit.',
  problems: [
    ['Lists are not owned', 'One company holds the list. Nobody else can see how it was built, audit it or rebuild it.'],
    ['Stale flags linger', 'Flags that never expire keep blocking sites that were fixed or sold. Scams move fast, so data needs a lifetime.'],
    ['No clean dispute path', 'A wrongly flagged project must contact a vendor and wait. There is no public, owner-controlled reply.'],
    ['Reports are easy to game', 'Anyone can make 1,000 wallets, so counting reports says nothing about who to trust.'],
  ] as Pair[],
  workflowTitle: 'Introducing Lookout.',
  intro:
    'Lookout is a pre-sign safety check for wallets and AI agents. Every signal behind its block, warn or unknown verdict is an Arkiv entity.',
  workflow: [
    ['Write', 'Reporters, open feeds and our checker post signed entities', 'arkiv', 'Arkiv write'],
    ['Arkiv', 'Each entity has an owner, attributes and an expiry', 'arkiv', 'Source of truth'],
    ['Index', 'Indexers read by attribute and publish a snapshot root back to Arkiv'],
    ['Read', 'The wallet verdict screen is built from Arkiv entities', 'arkiv', 'Arkiv read'],
    ['Rebuild', 'Wipe our servers, rebuild the same list from Arkiv alone'],
  ] as Step[],
  notes: ['Arkiv as a log nobody reads does not count, so the verdict screen reads straight from Arkiv.', DISPUTE_NOTE] as string[],
  modelTitle: 'Nine entity types, each with an owner and an expiry.',
  entities: [
    ['report', 'Target hash, type, evidence hash', 'Reporter', '24h unless confirmed'],
    ['verdict', 'Source result', 'Source wallet', 'Short, refreshed'],
    ['attestation', 'Owner dispute or confirmation', 'Deployer or ENS wallet', 'Longer'],
    ['stake', 'Deposit record', 'Reporter', 'Until resolved'],
    ['vote', 'Hidden juror vote', 'Juror', 'End of round'],
    ['ruling', 'Review outcome', 'Panel', 'Long'],
    ['reputation', 'Score per wallet, rebuilt from rulings', 'Indexer', 'Per snapshot'],
    ['snapshot', 'Root hash of the lookup table', 'Indexer', 'Per snapshot'],
    ['bounty', 'Stealth reward announcement', 'Project', 'Until claimed'],
  ] as [string, string, string, string][],
  why: [
    ['Ownership', 'We cannot edit anyone’s entry.'],
    ['Expiry', 'Scams die fast, so their flags do too.'],
    ['Attribute queries', 'Indexers build the lookup from them.'],
    ['Source of truth', 'Wipe our servers and rebuild from Arkiv.'],
  ] as Pair[],
  notOnArkiv: 'Not on Arkiv: the PIR lookup tables and large evidence files. They are derived from Arkiv and published only as fingerprints.',
  trustTitle: 'Trust, rebuilt from public data.',
  feedbackLabel: 'Arkiv feedback we will report',
  feedback: [
    ['Plaintext attributes', 'Attributes are public, so only hashes and coarse categories go there.'],
    ['Expiry is not erasure', 'Expired entities stay in transaction history, so sensitive fields are encrypted.'],
    ['Gas for one-time keys', 'One-time writer keys need gas, which can link them to the account that funded them.'],
  ] as Pair[],
  line: 'No Arkiv, no Lookout.',
  lineSub: 'The data, ownership, expiry and disputes are all Arkiv entities.',
  limits: 'Arkiv is the source of truth, not the only store: PIR tables and large evidence are derived data with only a fingerprint on Arkiv.',
};

/* ---------- EF deck ---------- */

export const EF = {
  cover: {
    label: 'Lookout · Ethereum Foundation · CROPS',
    title: ['NOBODY SEES', 'WHAT YOU', 'CHECKED.'],
    lede: 'Private lookups over PIR, stealth bounties with no relayer, and no trackers. A scam check that does not become a surveillance point.',
  },
  problemTitle: 'The scam check watches you back.',
  problems: [
    ['The checker sees your query', 'To warn you about a site, a vendor must be told what you are about to sign. You trust one party and how it handles your queries.'],
    ['Lookups leak intent', 'Checking the same site again and again reveals what a user or an agent is doing.'],
    ['Payouts link people', 'Paying reporters through a relayer, or funding their gas, links the reward to their main wallet.'],
    ['Agents sign alone', 'AI agents sign with no human in the loop, so the check must be machine-readable and just as private.'],
  ] as Pair[],
  workflowTitle: 'Introducing Lookout.',
  intro:
    'Lookout is a pre-sign safety check for wallets and AI agents. It answers block, warn or unknown without learning what you asked, and pays reporters without a relayer.',
  workflow: [
    ['Ask privately', 'The client picks a random vector for the bucket it wants'],
    ['Two PIR servers', 'A gets r, B gets r with one bit flipped. Neither learns the target', 'ef', 'EF · PIR'],
    ['Verify', 'XOR the answers and check them against the snapshot root on Arkiv', 'arkiv', 'Arkiv root'],
    ['Verdict', 'Block, warn or unknown, decided on your device'],
    ['Stealth payout', 'Bounty to a one-time address in ETH. No relayer, no gas link', 'ef', 'EF · Stealth'],
  ] as Step[],
  notes: ['Keys, queries and the verdict cache stay on the device. No trackers.', 'Two-server PIR assumes the servers do not collude.'] as string[],
  // one simple slide per CROPS property: [mark, name, statement, points, honest limit]
  cropsSlides: [
    [
      'CR', 'Censorship resistance', 'No single party can delete or hide a report.',
      [
        'Reports are Arkiv entities, owned by the wallet that wrote them.',
        'Nobody can edit or remove another writer’s entry.',
        'Anyone can run an indexer and rebuild the list.',
      ],
      'The first reviewer panel and the list of trusted sources are seeded by the team, then opened up.',
    ],
    [
      'O', 'Open source', 'Everything is public under a FOSS license.',
      [
        'The code lives in a public repo.',
        'The scoring rule, the PIR servers and the client can be read by anyone.',
        'The lookup list rebuilds from Arkiv with open tools.',
      ],
      'The license file and the AI-use statement are still to be added before submission.',
    ],
    [
      'P', 'Privacy', 'Nobody sees what you checked.',
      [
        'PIR: each lookup server sees only a random-looking vector, never the target.',
        'Stealth bounties: a one-time address, no relayer, no gas link to the reporter.',
        'Keys and queries stay on the device, with no trackers.',
      ],
      'PIR assumes the two servers do not collude. An RPC node can still see your IP until Anon-RPC is in place, and its support is unverified.',
    ],
    [
      'S', 'Security', 'Answers are verified, and fake reports cost money.',
      [
        'The client checks every answer against a root published on Arkiv by several indexers.',
        'Anti-Sybil: weight not count, deposits, reputation and a reviewer panel.',
        'Block needs 2 or more source types, a ruling, or proof anyone can re-check.',
      ],
      'A rich, patient attacker raises the cost, and reviewers could be bribed. Random selection and stake make it harder, not impossible.',
    ],
  ] as [string, string, string, string[], string][],
  stackTitle: 'The privacy stack, and the demo.',
  stack: [
    ['Private lookup', '2-server PIR. Neither server learns which entry you asked for.', 'Core'],
    ['Stealth bounties', 'ERC-5564 style one-time address paid in ETH. No relayer, no gas-funding link.', 'Core'],
    ['Anon-RPC', 'PIR hides what you ask, but an RPC node still sees your IP. Anon-RPC is the EF track for IP-hiding access, so chain and Arkiv reads go through it.', 'Verify support'],
    ['EIP-8141 sweep', 'Sweep the stealth address with a frame transaction on the EF alt-mempool devnet. A draft proposal.', 'Verify support'],
  ] as [string, string, string][],
  demo: [
    ['Show the server logs', 'Both PIR servers log only random-looking vectors, never the target.'],
    ['Verified answer', 'The client reports the answer matches the root published on Arkiv.'],
    ['Claim a bounty', 'A fresh address pays its own gas, with no relayer and no link to the reporter.'],
  ] as Pair[],
  line: 'Nobody sees what you checked, nobody relays your payout,',
  lineSub: 'and a thousand fresh wallets cannot block a real site.',
  limits:
    'Said upfront: PIR assumes the two servers do not collude · Anon-RPC and EIP-8141 network support is unverified · reputation links reports to a wallet, so payouts are stealth but reputation is not',
};

// Content for the Arkiv pitch deck (src/Deck.tsx, src/deck-slides.tsx). The World ID deck is in pitch-worldid.ts.
// Everything here describes what is BUILT. Where something is a trust limit or not done, the slide says so.

export type Pair = [string, string];
export type Step = [title: string, caption: string, track?: 'arkiv' | 'worldid', tag?: string];

/* ---------- shared ---------- */

export const ONE_LINE =
  'A community-owned scam check for wallets and AI agents. Arkiv holds the shared data, trusted sources and reputation keep it honest, and lookups are private.';

export const SCALE: [string, string, string][] = [
  ['$14B+', 'onchain scams in 2025', 'Chainalysis estimate'],
  ['~$84M', 'lost to drainer phishing in 2025', 'Scam Sniffer'],
  ['106K', 'drainer victims in 2025', 'Scam Sniffer'],
];

export const DISPUTE_NOTE = 'Owners can dispute a flag by signing with the flagged address. Only a public operator ruling can overturn it.';
export const BLOCK_LINE = 'Block needs 2+ independent source types, an operator ruling, or proof anyone can re-check.';

export const SYBIL: Pair[] = [
  ['Deposits', 'Every report locks a deposit. It comes back when a trusted source corroborates the report, and is refunded if none does. Only an explicit operator ruling can forfeit it.'],
  ['Reputation', 'Earned when a trusted source corroborates a report, lost twice as fast when the operator rejects one, non-transferable, and it decays.'],
  ['Verified humans', 'World ID binds one human to one wallet, which gets a small reputation floor and bounty eligibility. Fresh wallets still weigh zero.'],
];

export const TRACK_LABEL: Record<string, string> = { arkiv: 'Arkiv', worldid: 'World ID' };

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
    'Lookout is a pre-sign safety check for wallets and AI agents. Every signal behind its block, warn or unknown verdict is an Arkiv entity, and the lookup does not reveal what you asked.',
  workflow: [
    ['Write', 'Reporters (with a deposit), open feeds and our checker post entities', 'arkiv', 'Arkiv write'],
    ['Arkiv', 'Each entity has an owner, attributes and an expiry', 'arkiv', 'Source of truth'],
    ['Index', 'Indexers read by attribute, apply the trust rules and publish a snapshot root back to Arkiv'],
    ['Private lookup', 'Two PIR servers answer without learning the target. The client checks the answer against the root on Arkiv'],
    ['Verdict', 'Block, warn or unknown, decided on your device. Never "safe"'],
  ] as Step[],
  notes: [
    'Arkiv as a log nobody reads does not count, so the verdict screen reads straight from Arkiv.',
    DISPUTE_NOTE,
    'Two-server PIR assumes the servers do not collude.',
  ] as string[],
  modelTitle: 'Seven entity types, each with an owner and an expiry.',
  entities: [
    ['report', 'Target hash and the plain target', 'Reporter', '24 hours'],
    ['verdict', 'A trusted source’s result', 'Source wallet', '6 hours, refreshed'],
    ['attestation', 'Owner dispute, with a signature proof', 'The flagged address', '30 days'],
    ['stake', 'Deposit record, mirrored from the escrow', 'Operator', 'Until settled'],
    ['ruling', 'Operator ruling, with a public reason', 'Operator', '90 days'],
    ['reputation', 'Score per wallet, per checkpoint', 'Operator / indexer', 'Per checkpoint'],
    ['snapshot', 'Root hash of the lookup table', 'Indexer', 'Per snapshot'],
  ] as [string, string, string, string][],
  why: [
    ['Ownership', 'We cannot edit anyone’s entry.'],
    ['Expiry', 'Scams die fast, so their flags do too.'],
    ['Attribute queries', 'Indexers build the lookup from them.'],
    ['Source of truth', 'Wipe our servers and rebuild from Arkiv.'],
  ] as Pair[],
  notOnArkiv: 'Not on Arkiv: the PIR lookup tables, and the money, which lives in an escrow contract. Both are derived from or mirrored to Arkiv.',
  trustTitle: 'Trust, rebuilt from public data.',
  feedbackLabel: 'Arkiv feedback we will report',
  feedback: [
    ['Plaintext attributes', 'Attributes are public, so only hashes and coarse categories go there.'],
    ['Expiry is not erasure', 'Expired entities stay in transaction history, so nothing sensitive belongs in a payload.'],
    ['RPC timeouts under load', 'The public endpoint timed out on writes, so clients need generous timeouts and retries.'],
  ] as Pair[],
  line: 'No Arkiv, no Lookout.',
  lineSub: 'The data, ownership, expiry and disputes are all Arkiv entities.',
  limits: 'Said upfront: one operator key settles reports and publishes rulings, which is a stated trust limit · PIR tables and the escrow are not on Arkiv.',
};

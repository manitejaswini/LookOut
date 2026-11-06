// Content for the World ID deck (/pitch/worldid): World "Best Use of IDKit".
// One trust moment, one credential, one alternative path. Edit wording here.

import type { Pair, Step } from './pitch-data';

export const WORLDID = {
  cover: {
    label: 'Lookout · World: Best Use of IDKit',
    title: ['ONE HUMAN,', 'ONE REPORTER.'],
    lede: 'Lookout uses World ID so a real person’s report counts a little, and one person cannot pass as a crowd.',
  },
  trustTitle: 'The trust moment: weighing a report.',
  trust: [
    ['What a report does', 'It warns. Together with a trusted source it can contribute to a block, and it earns the reporter reputation when it is corroborated.'],
    ['Why it needs trust', 'Fresh wallets cost nothing to make, so a thousand of them weigh zero. That also means a real first-time reporter weighs zero, and cannot be told apart from a bot.'],
    ['What we need to know', 'Only one thing: does this wallet belong to a real, unique person? Not who they are, how old they are, or where they are from.'],
  ] as Pair[],
  without: ['Without World ID', 'One actor with 1,000 wallets is 1,000 weightless reporters, and an honest newcomer looks exactly the same.'] as Pair,
  with: ['With World ID', 'One human gets one wallet with a small reputation floor and bounty eligibility, however many wallets they own.'] as Pair,
  choiceTitle: 'The minimum credential that is enough.',
  choices: [
    ['Proof of Human', 'A unique person, verified by an Orb', 'Chosen', 'The floor and the bounty should be one per person, and they carry value. That needs strong uniqueness and nothing else.'],
    ['Selfie Check', 'A live person, with lighter assurance', 'Not enough', 'Good for sign-up and bot defence, but too light to guard something that carries reputation and rewards.'],
    ['Passport / NFC', 'Attributes of a government document', 'Not needed', 'Proves more than we need. We only need uniqueness, so this adds data and friction.'],
    ['No credential (reporting)', 'Nothing', 'Still allowed', 'Anyone can report and check without it. The credential only adds a floor and bounty eligibility: it never gates reporting.'],
  ] as [string, string, string, string][],
  flowTitle: 'How it works, and when it fails.',
  flow: [
    ['Connect', 'The person connects the wallet they want verified'],
    ['Sign', 'The wallet signs a short message, so nobody can register a wallet they do not control'],
    ['IDKit proof', 'The user verifies with Proof of Human'],
    ['Server checks', 'Our server verifies the proof and stores one nullifier per human, bound to the wallet'],
    ['Floor', 'The next reputation checkpoint on Arkiv gives the wallet its floor'],
  ] as Step[],
  outcomes: [
    ['Verified', 'The wallet gets a reputation floor and can earn bounties.', 'ok'],
    ['Cancelled, or no credential', 'Nothing changes. The person can still report and check, with no floor.', 'warn'],
    ['Already verified', 'A second wallet from the same human is rejected: one human, one wallet.', 'block'],
  ] as [string, string, string][],
  statusTitle: 'Debrief, and where we honestly are.',
  debriefLabel: 'Integration debrief',
  debrief: [
    ['Time to first success', 'Not measured yet: it needs a real app id and a real proof from World App', 'Pending'],
    ['Friction encountered', 'Docs and SDK types disagree (nullifier hex vs decimal). The Portal domain differs between pages. Error codes exist only in the SDK', 'From the build'],
    ['Missing capability or docs', 'No server-side verify helper, no error-code table, and nothing showing how to enforce the signal', 'From the build'],
    ['Highest-impact improvement', 'One complete server reference: verify, check the credential, enforce the signal, store the nullifier', 'Our pick'],
  ] as [string, string, string][],
  statusLabel: 'Where we are',
  status: [
    ['Built and tested', 'The flow end to end: server proof checks, the wallet-signature step, the one-wallet-per-human store, the verify screen and both alternative paths. 58 tests in the package, and the real widget runs.'],
    ['Not done yet', 'A real proof. It needs a World Developer Portal app, then one run with World App or the simulator. Until then, success is shown by tests only.'],
  ] as Pair[],
  line: 'One human, one reporter.',
  lineSub: 'World ID tells us someone is unique, and nothing else.',
  limits:
    'Said upfront: World ID proves uniqueness, not honesty, so reputation still rises and falls with outcomes · our server verifies the proof, so that check is a trust assumption · no real World ID proof has been run end to end yet',
};

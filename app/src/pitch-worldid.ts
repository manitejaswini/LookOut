// Content for the World ID deck (/pitch/worldid): World "Best Use of IDKit".
// One trust moment, one credential, one alternative path. Edit wording here.

import type { Pair, Step } from './pitch-data';

export const WORLDID = {
  cover: {
    label: 'Lookout · World: Best Use of IDKit',
    title: ['ONE HUMAN,', 'ONE JUROR.'],
    lede: 'Lookout uses World ID to keep its reviewer panel honest: one person gets one seat, and nobody learns who they are.',
  },
  trustTitle: 'The trust moment: joining the reviewer panel.',
  trust: [
    ['What the panel does', 'It rules on disputed blocks, and it slashes the stake and reputation of jurors who vote on the losing side.'],
    ['Why it needs trust', 'If one actor can enroll many staked wallets, they can capture the panel, or bribe a few people who hold many seats.'],
    ['What we need to know', 'Only one thing: is this a real, unique person? Not who they are, how old they are, or where they are from.'],
  ] as Pair[],
  without: ['Without World ID', 'One actor with 10 wallets holds 10 seats. A thousand wallets can crowd out real reviewers.'] as Pair,
  with: ['With World ID', 'One human gets one seat, however many wallets they own. A panel of 5 is 5 different people.'] as Pair,
  choiceTitle: 'The minimum credential that is enough.',
  choices: [
    ['Proof of Human', 'A unique person, verified by an Orb', 'Chosen', 'The panel needs strong uniqueness and nothing else. Jurors can slash stake, so this seat check should use the strongest uniqueness signal.'],
    ['Selfie Check', 'A live person, with lighter assurance', 'Not enough', 'Good for sign-up and bot defence, but too light to guard seats that rule on blocks.'],
    ['Passport / NFC', 'Attributes of a government document', 'Not needed', 'Proves more than we need. We only need uniqueness, so this adds data and friction.'],
    ['No credential (reporters)', 'Nothing', 'Not used', 'Reports alone can only warn, and deposits and reputation already limit them. Open reporting stays open.'],
  ] as [string, string, string, string][],
  flowTitle: 'How it works, and when it fails.',
  flow: [
    ['Join panel', 'A staked wallet asks for a reviewer seat'],
    ['IDKit proof', 'The user verifies with Proof of Human'],
    ['Server checks', 'Our server verifies the proof and stores only a one-time id (nullifier)'],
    ['Seat granted', 'The wallet joins the pool that jurors are drawn from'],
  ] as Step[],
  outcomes: [
    ['Verified', 'Seat granted. Jurors are drawn at random and vote hidden, then reveal.', 'ok'],
    ['Cancelled, or no credential', 'No seat. The person can still file reports and loses nothing else.', 'warn'],
    ['Already enrolled', 'A second wallet from the same human is rejected: one human, one seat.', 'block'],
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
    ['Built and tested', 'The seat flow end to end: server proof checks, the one-seat store, the join screen and both alternative paths. 56 tests, and the real widget runs.'],
    ['Not done yet', 'A real proof. It needs a World Developer Portal app, then one run with World App or the simulator. Until then, success is shown by tests only.'],
  ] as Pair[],
  line: 'One human, one juror.',
  lineSub: 'World ID tells us someone is unique, and nothing else.',
  limits:
    'Said upfront: World ID proves uniqueness, not honesty, so jurors still stake, vote blind and lose reputation when wrong · it does not stop a rich human from bribing others · no real World ID proof has been run end to end yet',
};

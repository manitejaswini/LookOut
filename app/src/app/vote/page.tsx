import type { Metadata } from 'next';
import VotePanel from '../../VotePanel';

export const metadata: Metadata = {
  title: 'Cast a vote · Lookout',
  description: 'Reviewers vote on disputed blocks: a hidden vote first, then a reveal, so nobody can copy or be pressured.',
};

export default function VotePage() {
  return (
    <main>
      <section className="section">
        <div className="split">
          <div>
            <h2>Vote hidden, then reveal.</h2>
            <p className="mono-label">Reviewers</p>
            <p className="lede-sm">
              Jurors are drawn at random from the World ID seat pool. You first publish only a fingerprint of your vote, so nobody can copy it.
              After the commit round closes you reveal it, and anyone can check the reveal matches.
            </p>
            <ul className="why-list">
              <li><b>Keep this browser.</b> The secret that opens your vote is stored here only.</li>
              <li><b>Majority wins.</b> Jurors on the winning side gain reputation. Losing or not revealing costs stake.</li>
            </ul>
          </div>
          <VotePanel />
        </div>
      </section>
    </main>
  );
}

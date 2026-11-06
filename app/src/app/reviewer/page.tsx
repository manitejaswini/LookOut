import type { Metadata } from 'next';
import ReviewerJoin from '../../ReviewerJoin';
import StakePanel from '../../StakePanel';

export const metadata: Metadata = {
  title: 'Join the reviewer panel · Lookout',
  description: 'One human, one reviewer seat, proven with World ID Proof of Human without revealing who you are.',
};

export default function ReviewerPage() {
  return (
    <main>
      <section className="section">
        <div className="split">
          <div>
            <h2>One human, one juror.</h2>
            <p className="mono-label">Join the reviewer panel</p>
            <p className="lede-sm">
              Reviewers rule on disputed blocks, and jurors who vote on the losing side lose stake and reputation. If one person could hold many
              seats, they could capture the panel. World ID proves you are one unique human and nothing else.
            </p>
            <ul className="why-list">
              <li><b>Why Proof of Human.</b> The seat needs strong uniqueness and nothing more, so no name, age or document is asked for.</li>
              <li><b>Why not for reporters.</b> Reports can only warn, and deposits and reputation already limit them. Open reporting stays open.</li>
              <li><b>What we keep.</b> Only an anonymous, per-app identifier (a nullifier) and your wallet. Never who you are.</li>
            </ul>
          </div>
          <div>
            <ReviewerJoin />
            <StakePanel />
          </div>
        </div>
      </section>
    </main>
  );
}

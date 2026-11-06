import type { Metadata } from 'next';
import VerifyHuman from '../../VerifyHuman';

export const metadata: Metadata = {
  title: 'Verify you are human · Lookout',
  description: 'One human, one wallet, proven with World ID Proof of Human without revealing who you are.',
};

export default function VerifyPage() {
  return (
    <main>
      <section className="section">
        <div className="split">
          <div>
            <h2>One human, one reporter.</h2>
            <p className="mono-label">Verify you are human</p>
            <p className="lede-sm">
              A thousand fresh wallets cost nothing to make, so a fresh wallet&apos;s report weighs nothing. A wallet bound to one verified human gets a small
              reputation floor, so a real person&apos;s report counts a little, and it can earn private bounties. One human can only ever have one such wallet.
            </p>
            <ul className="why-list">
              <li><b>Why Proof of Human.</b> Lookout needs strong uniqueness and nothing more, so no name, age or document is asked for.</li>
              <li><b>What it does not do.</b> It never blocks a site by itself. A report still needs a trusted source to corroborate it.</li>
              <li><b>What we keep.</b> An anonymous per-app identifier (a nullifier) and your wallet. Never who you are.</li>
            </ul>
          </div>
          <VerifyHuman />
        </div>
      </section>
    </main>
  );
}

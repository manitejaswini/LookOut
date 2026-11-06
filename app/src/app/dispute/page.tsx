import type { Metadata } from 'next';
import DisputePage from '../../DisputePage';

export const metadata: Metadata = {
  title: 'Dispute a flag · Lookout',
  description: 'If your own address is flagged, prove it is yours with a signature and ask the review panel to look at it.',
};

export default async function Dispute({ searchParams }: { searchParams: Promise<{ target?: string }> }) {
  const q = await searchParams;
  return (
    <main>
      <section className="section">
        <div className="split">
          <div>
            <h2>Your address is flagged. Say so, with proof.</h2>
            <p className="mono-label">Owners</p>
            <p className="lede-sm">
              If a wallet address you control is flagged, sign a short message with it. Nobody can fake that signature, and anyone can check it.
              The review panel then rules on the flag. A dispute never removes a flag by itself.
            </p>
            <ul className="why-list">
              <li><b>Your wallet signs.</b> Signing costs nothing and sends no money.</li>
              <li><b>Panel decides.</b> Jurors are drawn at random from verified humans and vote hidden, then reveal.</li>
              <li><b>Limits.</b> Wallet addresses only for now. Contracts have no key, and domains need a different proof.</li>
            </ul>
          </div>
          <DisputePage initialTarget={typeof q.target === 'string' ? q.target.slice(0, 60) : undefined} />
        </div>
      </section>
    </main>
  );
}

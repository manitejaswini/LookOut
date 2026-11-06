import type { Metadata } from 'next';
import PayPage from '../../PayPage';

export const metadata: Metadata = {
  title: 'Send ETH, checked first · Lookout',
  description: 'Pay an address and see, before your wallet signs, whether it is flagged as a scam, and why.',
};

export default function Pay() {
  return (
    <main>
      <section className="section">
        <div className="split">
          <div>
            <h2>Check the address before the money moves.</h2>
            <p className="mono-label">Pay with a pre-sign check</p>
            <p className="lede-sm">
              Enter who you are paying. Lookout checks the address privately, then tells you what it found and why, before your wallet is asked to sign.
              You always have the final say: a flagged address can still be paid, but only if you choose to, and that choice is logged.
            </p>
            <ul className="why-list">
              <li><b>Private.</b> Two servers answer one question without either learning which address you asked about.</li>
              <li><b>Verifiable.</b> Every flag lists its source and a public Arkiv record. The table itself is checked against a root published on Arkiv.</li>
              <li><b>Honest.</b> Lookout says &quot;no reports found&quot;, never &quot;safe&quot;. A failed check is never treated as a pass.</li>
            </ul>
          </div>
          <PayPage />
        </div>
      </section>
    </main>
  );
}

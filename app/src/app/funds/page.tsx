import type { Metadata } from 'next';
import FundsPage from '../../FundsPage';

export const metadata: Metadata = {
  title: 'Your escrow funds · Lookout',
  description: 'Claim refunds and take back deposits nobody settled.',
};

export default function Page() {
  return (
    <main>
      <section className="section">
        <div className="split">
          <div>
            <h2>What the escrow holds for you.</h2>
            <p className="mono-label">Reporters</p>
            <p className="lede-sm">A confirmed report earns the deposit back, and you claim it yourself. If nobody rules in time you can take the deposit back after the window.</p>
            <ul className="why-list">
              <li><b>Refunds are pulled.</b> You claim them, so no wallet can block anyone else.</li>
              <li><b>Deposits are not lost.</b> A report nobody corroborates is refunded with no bounty, and you can always reclaim after the window.</li>
            </ul>
          </div>
          <FundsPage />
        </div>
      </section>
    </main>
  );
}

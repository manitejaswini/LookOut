import type { Metadata } from 'next';
import ClaimPage from '../../ClaimPage';

export const metadata: Metadata = {
  title: 'Collect a bounty · Lookout',
  description: 'Collect a private bounty with the key kept in your browser.',
};

export default function Page() {
  return (
    <main>
      <section className="section">
        <div className="split">
          <div>
            <h2>Collect your bounty, privately.</h2>
            <p className="mono-label">Reporters</p>
            <p className="lede-sm">When the panel confirms your report you may be paid a bounty at a one-time address that only your own key can find. Collect it here, to an address you choose.</p>
            <ul className="why-list">
              <li><b>Your key, your browser.</b> The bounty key never leaves this browser. Back it up, or the bounty is lost.</li>
              <li><b>Use a fresh address.</b> Sending it to the wallet that filed the report links the two. We warn you before you do.</li>
              <li><b>No relayer.</b> The one-time address pays its own network fee out of the bounty.</li>
            </ul>
          </div>
          <ClaimPage />
        </div>
      </section>
    </main>
  );
}

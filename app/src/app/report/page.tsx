import type { Metadata } from 'next';
import ReportForm from '../../ReportForm';

export const metadata: Metadata = {
  title: 'Report a scam · Lookout',
  description: 'File a scam report with a refundable deposit. Honest reports get the deposit back and earn reputation.',
};

export default async function ReportPage({ searchParams }: { searchParams: Promise<{ kind?: string; value?: string }> }) {
  const q = await searchParams;
  const kind = q.kind === 'address' || q.kind === 'contract' || q.kind === 'domain' ? q.kind : undefined;
  return (
    <main>
      <section className="section">
        <div className="split">
          <div>
            <h2>Report a scam, with skin in the game.</h2>
            <p className="mono-label">Reporters</p>
            <p className="lede-sm">
              Anyone can report. A small deposit goes into escrow, so spam costs money. If the panel confirms your report you get the deposit back,
              earn reputation, and may be paid a bounty to a one-time address that nobody can link to you. If it is rejected, the deposit funds the bounty pool.
            </p>
            <ul className="why-list">
              <li><b>Reports alone never block.</b> A new wallet weighs nothing. Blocking needs independent strong signals or a panel ruling.</li>
              <li><b>Your wallet signs.</b> We never hold a key. Two approvals: the deposit, then the report.</li>
              <li><b>Testnet.</b> Deposits are test ETH on Sepolia and reports go to the Arkiv testnet.</li>
            </ul>
          </div>
          <ReportForm initialKind={kind} initialValue={typeof q.value === 'string' ? q.value.slice(0, 300) : undefined} />
        </div>
      </section>
    </main>
  );
}

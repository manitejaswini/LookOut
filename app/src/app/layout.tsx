import type { Metadata } from 'next';
import '@fontsource-variable/space-grotesk';
import './globals.css';
import Header from '../Header';
import { WalletProvider } from '../wallet/WalletProvider';

export const metadata: Metadata = {
  title: 'Lookout · check before you sign',
  description: 'A pre-sign safety check for wallets and AI agents. Scam intel on Arkiv, private lookups, trust by reputation.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <WalletProvider>
          <Header />
          {children}
        </WalletProvider>
      </body>
    </html>
  );
}

import type { Metadata } from 'next';
import Deck from '../../../Deck';

export const metadata: Metadata = {
  title: 'EF pitch · Lookout',
  description: 'Lookout for the Ethereum Foundation CROPS track: private PIR lookups, stealth bounties and no relayer.',
};

export default function EfPitch() {
  return (
    <main>
      <Deck track="ef" />
    </main>
  );
}

import type { Metadata } from 'next';
import Deck from '../../../Deck';

export const metadata: Metadata = {
  title: 'Arkiv pitch · Lookout',
  description: 'Lookout for the Arkiv track: scam intel as owned, expiring entities that rebuild from Arkiv alone.',
};

export default function ArkivPitch() {
  return (
    <main>
      <Deck track="arkiv" />
    </main>
  );
}

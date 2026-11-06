import type { Metadata } from 'next';
import Deck from '../../../Deck';

export const metadata: Metadata = {
  title: 'World ID pitch · Lookout',
  description: 'Lookout for World Best Use of IDKit: one human, one reporter wallet, proven without revealing identity.',
};

export default function WorldIdPitch() {
  return (
    <main>
      <Deck track="worldid" />
    </main>
  );
}

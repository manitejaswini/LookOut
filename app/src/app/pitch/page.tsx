import type { Metadata } from 'next';
import Deck from '../../Deck';
import { ONE_LINE } from '../../pitch-data';

export const metadata: Metadata = {
  title: 'Pitch · Lookout',
  description: ONE_LINE,
};

export default function Pitch() {
  return (
    <main>
      <Deck />
    </main>
  );
}

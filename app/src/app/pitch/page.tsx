import { redirect } from 'next/navigation';

// The pitch is now two decks. Old links go to the Arkiv one.
export default function Pitch() {
  redirect('/pitch/arkiv');
}

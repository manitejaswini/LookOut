'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const NAV: [string, string][] = [
  ['/#check', 'Check'],
  ['/#attack', 'Attack'],
  ['/#explorer', 'Explorer'],
  ['/#agent', 'Agent'],
  ['/#how', 'How it works'],
  ['/pitch/arkiv', 'Arkiv pitch'],
  ['/pitch/ef', 'EF pitch'],
];

export default function Header() {
  const path = usePathname();
  return (
    <header className="topbar">
      <Link href="/" className="logo"><span className="logo-px" aria-hidden="true" />LOOKOUT</Link>
      <nav aria-label="Primary">
        {NAV.map(([href, label]) => (
          <Link key={href} href={href} aria-current={href === path ? 'page' : undefined} className={href.startsWith('/pitch') ? 'nav-pitch' : undefined}>
            {label}
          </Link>
        ))}
      </nav>
    </header>
  );
}

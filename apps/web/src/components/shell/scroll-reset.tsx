'use client';

import { usePathname } from 'next/navigation';
import { useEffect } from 'react';

/** Window no longer scrolls in the app shell, so do Next's "new page starts at the top" on <main>. */
export function ScrollReset() {
  const pathname = usePathname();
  useEffect(() => {
    const main = document.getElementById('af-main');
    if (!main) return;
    if (location.hash) document.getElementById(location.hash.slice(1))?.scrollIntoView();
    else main.scrollTo({ top: 0 });
  }, [pathname]);
  return null;
}

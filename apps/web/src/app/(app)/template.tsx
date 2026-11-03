'use client';

import { useEffect, useState } from 'react';

declare global {
  interface Window {
    __afShellMounted?: boolean;
  }
}

/**
 * Route enter: CSS `af-route` (6px rise + fade, 200ms; off for reduced motion). No motion library.
 * The first paint belongs to the splash and the SSR HTML, so only client-side navigations animate.
 */
export default function Template({ children }: { children: React.ReactNode }) {
  const [animateIn] = useState(
    () => typeof window !== 'undefined' && window.__afShellMounted === true,
  );
  useEffect(() => {
    window.__afShellMounted = true;
  }, []);
  return (
    <div className={`flex min-w-0 flex-1 flex-col${animateIn ? ' af-route' : ''}`}>{children}</div>
  );
}

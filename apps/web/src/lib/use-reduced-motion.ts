'use client';

import { useSyncExternalStore } from 'react';

const q = '(prefers-reduced-motion: reduce)';
const subscribe = (cb: () => void) => {
  const m = window.matchMedia(q);
  m.addEventListener('change', cb);
  return () => m.removeEventListener('change', cb);
};

/** True when the OS asks for reduced motion (charts then render without animating). */
export function useReducedMotion() {
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(q).matches,
    () => true,
  );
}

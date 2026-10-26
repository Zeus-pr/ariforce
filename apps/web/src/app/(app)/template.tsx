'use client';

import { motion } from 'motion/react';
import { useEffect, useState } from 'react';

declare global {
  interface Window {
    __afShellMounted?: boolean;
  }
}

/**
 * Route enter: 6px rise + fade, 200ms, opacity/transform only (MotionConfig drops the rise for reduced motion).
 * The first paint belongs to the splash and the SSR HTML, so only client-side navigations animate.
 */
export default function Template({ children }: { children: React.ReactNode }) {
  const [animateIn] = useState(() => typeof window !== 'undefined' && window.__afShellMounted === true);
  useEffect(() => {
    window.__afShellMounted = true;
  }, []);
  return (
    <motion.div
      initial={animateIn ? { opacity: 0, y: 6 } : false}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2, ease: [0.23, 1, 0.32, 1] }}
      className="flex min-w-0 flex-1 flex-col"
    >
      {children}
    </motion.div>
  );
}

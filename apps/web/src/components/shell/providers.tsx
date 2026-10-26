'use client';

import { MotionConfig } from 'motion/react';

/** App-wide client providers. Light theme only. reducedMotion="user": motion components drop transforms when the OS asks. */
export function Providers({ children }: { children: React.ReactNode }) {
  return <MotionConfig reducedMotion="user">{children}</MotionConfig>;
}

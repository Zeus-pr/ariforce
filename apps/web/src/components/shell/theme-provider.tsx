'use client';

import { MotionConfig } from 'motion/react';
import { ThemeProvider as NextThemes } from 'next-themes';

/**
 * Light / dark / system, persisted in localStorage ("af:theme"). next-themes injects a blocking
 * inline script that sets the `.dark` class on <html> before first paint, so there is no flash.
 */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  return (
    <NextThemes attribute="class" defaultTheme="system" enableSystem storageKey="af:theme" disableTransitionOnChange>
      {/* reducedMotion="user": every motion component drops transforms when the OS asks for reduced motion. */}
      <MotionConfig reducedMotion="user">{children}</MotionConfig>
    </NextThemes>
  );
}

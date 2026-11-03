'use client';

/** App-wide client providers. Light theme only. Motion is CSS-only (globals.css honours reduced motion). */
export function Providers({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

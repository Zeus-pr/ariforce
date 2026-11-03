'use client';

import { useEffect } from 'react';
import { SPLASH_CLASS } from '@/components/splash/splash-script';

// Route error boundary: drop the splash so the message is visible and clickable.
export default function RouteError({ reset }: { error: Error; reset: () => void }) {
  useEffect(() => {
    document.documentElement.classList.remove(SPLASH_CLASS);
  }, []);
  return (
    <div className="mx-auto flex max-w-md flex-col gap-3 p-6" role="alert">
      <h1 className="text-xl font-semibold">Something went wrong</h1>
      <p className="text-sm text-muted-foreground">
        This page could not load. Try again, or sign in again.
      </p>
      <div className="flex gap-3">
        <button type="button" className="underline" onClick={() => reset()}>
          Try again
        </button>
        <a className="underline" href="/sign-in">
          Go to sign in
        </a>
      </div>
    </div>
  );
}

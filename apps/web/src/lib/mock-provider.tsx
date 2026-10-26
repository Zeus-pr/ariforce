'use client';

import { useEffect, useState } from 'react';
import { API_BASE_URL, API_MODE } from './api';

/** In mock mode, start the MSW worker (contracts mock handlers) before rendering children. */
export function MockProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(API_MODE === 'real');
  useEffect(() => {
    if (API_MODE === 'real') return;
    void (async () => {
      const [{ setupWorker }, { createHandlers }] = await Promise.all([
        import('msw/browser'),
        import('@ariforce/contracts/mocks'),
      ]);
      await setupWorker(...createHandlers(API_BASE_URL)).start();
      setReady(true);
    })();
  }, []);
  return ready ? children : null;
}

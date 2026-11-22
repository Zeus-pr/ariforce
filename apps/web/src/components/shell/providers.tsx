'use client';

import { AnimateUIProvider } from '@animate-ui/react/provider';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from '@/lib/query';

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <AnimateUIProvider checkAnimation="pop">
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </AnimateUIProvider>
  );
}

import { QueryClient } from '@tanstack/react-query';
import { AuthError } from './auth-api';

/** CUTLY defaults: one retry, no refetch on focus. Never retry a rejected session or role. */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (count, err) =>
        count < 1 &&
        !(
          err instanceof AuthError &&
          (err.kind === 'unauthorized' || err.kind === 'no-role' || err.kind === 'account')
        ),
      refetchOnWindowFocus: false,
      staleTime: 60_000,
    },
    mutations: { retry: false },
  },
});

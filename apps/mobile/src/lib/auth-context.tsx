/**
 * Session state. The bearer token lives in SecureStore; the profile (GET /v1/me) is a TanStack
 * Query keyed by the token, seeded from the last profile saved in SecureStore so a signed-in
 * launch opens home at once and revalidates in the background (CUTLY "hydrate fast-path").
 */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {
  AuthError,
  fetchMe,
  sendLoginOtp,
  signInEmail,
  signOutRemote,
  verifyLoginOtp,
  type AuthUser,
  type OtpChallenge,
} from './auth-api';
import { tokenStore } from './token-store';

type Status = 'loading' | 'signed-out' | 'signed-in';

type AuthContextValue = {
  status: Status;
  user: AuthUser | null;
  /** Why the app signed the user out on its own (e.g. role without access); shown on sign-in. */
  notice: string | null;
  clearNotice: () => void;
  /** Resolves with an OTP challenge when the server emailed a sign-in code, otherwise signs in. */
  signIn: (email: string, password: string) => Promise<OtpChallenge | void>;
  completeOtp: (challenge: OtpChallenge, code: string) => Promise<void>;
  resendOtp: (challenge: OtpChallenge) => Promise<void>;
  signOut: () => Promise<void>;
  refresh: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

const meKey = (token: string | null) => ['me', token] as const;

/** Read once at module load so hydration starts before the first render (CUTLY). */
const hydration = Promise.all([
  tokenStore.getToken().catch(() => null),
  tokenStore.getUser<AuthUser>().catch(() => null),
]);

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  // undefined = still reading SecureStore.
  const [token, setToken] = useState<string | null | undefined>(undefined);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    hydration.then(([t, cached]) => {
      if (!alive) return;
      if (t && cached) queryClient.setQueryData(meKey(t), cached, { updatedAt: 0 });
      setToken(t);
    });
    return () => {
      alive = false;
    };
  }, [queryClient]);

  const me = useQuery({
    queryKey: meKey(token ?? null),
    queryFn: () => fetchMe(token as string),
    enabled: !!token,
  });

  const endSession = useCallback(
    async (message: string | null, remote = true) => {
      const t = await tokenStore.getToken().catch(() => null);
      if (t && remote) await signOutRemote(t);
      await tokenStore.clear();
      queryClient.clear();
      setNotice(message);
      setToken(null);
    },
    [queryClient],
  );

  // A restored session that the server rejects, or whose role has no access, ends here.
  useEffect(() => {
    const err = me.error;
    if (!(err instanceof AuthError)) return;
    if (err.kind === 'unauthorized')
      void endSession('Your session has ended. Sign in again.', false);
    else if (err.kind === 'no-role' || err.kind === 'account') void endSession(err.message);
  }, [me.error, endSession]);

  useEffect(() => {
    if (me.data) void tokenStore.setUser(me.data);
  }, [me.data]);

  const finishWithToken = useCallback(
    async (t: string) => {
      let user: AuthUser;
      try {
        user = await fetchMe(t);
      } catch (e) {
        // Signed in to better-auth but no AriForce access (pending, no portal role…): end it again.
        await signOutRemote(t);
        throw e;
      }
      await tokenStore.setToken(t);
      await tokenStore.setUser(user);
      queryClient.setQueryData(meKey(t), user);
      setToken(t);
    },
    [queryClient],
  );

  const signIn = useCallback(
    async (email: string, password: string) => {
      setNotice(null);
      const r = await signInEmail(email, password);
      if (typeof r !== 'string') return r;
      await finishWithToken(r);
    },
    [finishWithToken],
  );

  const completeOtp = useCallback(
    async (challenge: OtpChallenge, code: string) => {
      await finishWithToken(await verifyLoginOtp(challenge, code));
    },
    [finishWithToken],
  );

  const resendOtp = useCallback((challenge: OtpChallenge) => sendLoginOtp(challenge), []);

  const signOut = useCallback(() => endSession(null), [endSession]);

  const refresh = useCallback(async () => {
    await me.refetch();
  }, [me]);

  const status: Status =
    token === undefined
      ? 'loading'
      : !token
        ? 'signed-out'
        : me.data
          ? 'signed-in'
          : me.isError
            ? 'signed-out'
            : 'loading';

  const value = useMemo<AuthContextValue>(
    () => ({
      status,
      user: me.data ?? null,
      notice,
      clearNotice: () => setNotice(null),
      signIn,
      completeOtp,
      resendOtp,
      signOut,
      refresh,
    }),
    [status, me.data, notice, signIn, completeOtp, resendOtp, signOut, refresh],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}

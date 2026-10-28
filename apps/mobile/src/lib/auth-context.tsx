import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { AuthError, fetchMe, signInEmail, signOutRemote, type AuthUser } from './auth-api';
import { tokenStore } from './token-store';

type AuthState =
  | { status: 'loading'; user: null }
  | { status: 'signed-out'; user: null }
  | { status: 'signed-in'; user: AuthUser };

type AuthContextValue = AuthState & {
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  refresh: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: 'loading', user: null });

  // Restore the session on launch: token from secure-store, then GET /v1/me.
  // Offline: keep the cached profile so the app still opens signed in.
  useEffect(() => {
    let alive = true;
    (async () => {
      const token = await tokenStore.getToken().catch(() => null);
      if (!token) {
        if (alive) setState({ status: 'signed-out', user: null });
        return;
      }
      try {
        const user = await fetchMe(token);
        await tokenStore.setUser(user);
        if (alive) setState({ status: 'signed-in', user });
      } catch (e) {
        const cached = await tokenStore.getUser<AuthUser>();
        if (e instanceof AuthError && e.kind === 'network' && cached) {
          if (alive) setState({ status: 'signed-in', user: cached });
          return;
        }
        await tokenStore.clear();
        if (alive) setState({ status: 'signed-out', user: null });
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const signIn = useCallback(async (email: string, password: string) => {
    const token = await signInEmail(email, password);
    let user: AuthUser;
    try {
      user = await fetchMe(token);
    } catch (e) {
      // Signed in to better-auth but no AriForce access (e.g. pending): drop that session again.
      await signOutRemote(token);
      throw e;
    }
    await tokenStore.setToken(token);
    await tokenStore.setUser(user);
    setState({ status: 'signed-in', user });
  }, []);

  const signOut = useCallback(async () => {
    const token = await tokenStore.getToken().catch(() => null);
    if (token) await signOutRemote(token);
    await tokenStore.clear();
    setState({ status: 'signed-out', user: null });
  }, []);

  const refresh = useCallback(async () => {
    const token = await tokenStore.getToken();
    if (!token) return;
    try {
      const user = await fetchMe(token);
      await tokenStore.setUser(user);
      setState({ status: 'signed-in', user });
    } catch (e) {
      if (e instanceof AuthError && e.kind === 'unauthorized') {
        await tokenStore.clear();
        setState({ status: 'signed-out', user: null });
      }
    }
  }, []);

  const value = useMemo(
    () => ({ ...state, signIn, signOut, refresh }),
    [state, signIn, signOut, refresh],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}

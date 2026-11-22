/**
 * Who is signed in. Every screen reads this through useAuth().
 *
 * On app start: load tokens from SecureStore → GET /users/me. If that works
 * the user lands straight in the app; otherwise they see the login screen.
 */
import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react';

import { api, setSessionExpiredHandler } from '../api/client';
import { clearTokens, loadTokens, saveTokens } from '../api/tokenStore';
import type { AuthResponse, Role, UserMe } from '../api/types';

type Status = 'loading' | 'signedOut' | 'signedIn';

interface AuthValue {
  status: Status;
  user: UserMe | null;
  login: (email: string, password: string) => Promise<void>;
  register: (data: { name: string; email: string; password: string; role: Role; phone?: string }) => Promise<void>;
  logout: () => Promise<void>;
  updateMe: (changes: Partial<UserMe>) => Promise<void>;
}

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>('loading');
  const [user, setUser] = useState<UserMe | null>(null);

  const signOutLocally = useCallback(() => {
    setUser(null);
    setStatus('signedOut');
  }, []);

  useEffect(() => {
    setSessionExpiredHandler(signOutLocally);
    (async () => {
      try {
        if (await loadTokens()) {
          setUser(await api<UserMe>('/users/me'));
          setStatus('signedIn');
          return;
        }
      } catch {
        // offline or tokens invalid: fall through to the login screen
      }
      setStatus('signedOut');
    })();
  }, [signOutLocally]);

  const handleAuth = useCallback(async (res: AuthResponse) => {
    await saveTokens(res.access_token, res.refresh_token);
    setUser(res.user);
    setStatus('signedIn');
  }, []);

  const value = useMemo<AuthValue>(
    () => ({
      status,
      user,
      login: async (email, password) =>
        handleAuth(await api<AuthResponse>('/auth/login', { method: 'POST', body: { email, password }, auth: false })),
      register: async (data) =>
        handleAuth(await api<AuthResponse>('/auth/register', { method: 'POST', body: data, auth: false })),
      logout: async () => {
        await clearTokens();
        signOutLocally();
      },
      updateMe: async (changes) => {
        setUser(await api<UserMe>('/users/me', { method: 'PATCH', body: changes }));
      },
    }),
    [status, user, handleAuth, signOutLocally],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, refreshSession, setSession, setSignedOutHandler } from './api';
import { getRefreshToken } from './storage';
import type { User } from './types';

interface AuthState {
  user: User | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  register: (displayName: string, email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  /** Replace the cached user after a profile edit. */
  setUser: (u: User) => void;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  // Restore the session on launch from the stored refresh token.
  useEffect(() => {
    setSignedOutHandler(() => setUser(null));
    (async () => {
      try {
        if ((await getRefreshToken()) && (await refreshSession())) {
          const me = await api.get<{ user: User }>('/me');
          setUser(me.user);
        }
      } catch {
        setUser(null);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const signIn = useCallback(async (email: string, password: string) => {
    const res = await api.post<{ user: User; accessToken: string; refreshToken: string }>('/auth/login', { email, password });
    await setSession(res.accessToken, res.refreshToken);
    setUser(res.user);
  }, []);

  const register = useCallback(async (displayName: string, email: string, password: string) => {
    const res = await api.post<{ user: User; accessToken: string; refreshToken: string }>('/auth/register', {
      displayName,
      email,
      password,
    });
    await setSession(res.accessToken, res.refreshToken);
    setUser(res.user);
  }, []);

  const signOut = useCallback(async () => {
    const token = await getRefreshToken();
    if (token) await api.post('/auth/logout', { refreshToken: token }).catch(() => {});
    await setSession(null, null);
    setUser(null);
  }, []);

  const value = useMemo(() => ({ user, loading, signIn, register, signOut, setUser }), [user, loading, signIn, register, signOut]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}

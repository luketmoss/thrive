import { useState, useEffect, useCallback, useRef } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import { AuthContext } from './auth-context';
import type { UserInfo } from '../api/types';
import { registerReauthCallback, onReauthFailed } from './reauth';
import { showToast } from '../state/store';

const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID;
const SCOPES = 'https://www.googleapis.com/auth/spreadsheets openid email profile';

const TOKEN_KEY = 'gw_token';
const USER_KEY = 'gw_user';
const TOKEN_EXPIRY_KEY = 'gw_token_expiry';

export function loadCachedAuth(): { token: string; user: UserInfo; expiry: number } | null {
  try {
    const token = localStorage.getItem(TOKEN_KEY);
    const user = localStorage.getItem(USER_KEY);
    const expiry = localStorage.getItem(TOKEN_EXPIRY_KEY);
    if (token && user && expiry && Date.now() < Number(expiry)) {
      return { token, user: JSON.parse(user), expiry: Number(expiry) };
    }
    // Expired or missing — clear stale data
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    localStorage.removeItem(TOKEN_EXPIRY_KEY);
  } catch { /* ignore */ }
  return null;
}

export function saveCachedAuth(token: string, user: UserInfo, expiresIn: number) {
  try {
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(USER_KEY, JSON.stringify(user));
    // GIS tokens last ~3600s; shave 60s to avoid edge-case expiry
    localStorage.setItem(TOKEN_EXPIRY_KEY, String(Date.now() + (expiresIn - 60) * 1000));
  } catch { /* ignore */ }
}

export function clearCachedAuth() {
  try {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    localStorage.removeItem(TOKEN_EXPIRY_KEY);
  } catch { /* ignore */ }
}

declare const google: any;

interface Props {
  children: ComponentChildren;
}

export function AuthProvider({ children }: Props) {
  const cached = loadCachedAuth();
  const [token, setToken] = useState<string | null>(cached?.token ?? null);
  const [user, setUser] = useState<UserInfo | null>(cached?.user ?? null);
  const tokenClientRef = useRef<any>(null);

  /**
   * Pending reauth resolver. When a silent re-auth is triggered by a 401
   * in sheets.ts, we store the resolve/reject pair here so the GIS callback
   * can settle the promise returned to the API layer.
   */
  const reauthResolveRef = useRef<((token: string) => void) | null>(null);
  const reauthRejectRef = useRef<((err: Error) => void) | null>(null);

  useEffect(() => {
    // Wait for GIS script to load
    const init = () => {
      if (typeof google === 'undefined' || !google.accounts?.oauth2) {
        setTimeout(init, 100);
        return;
      }

      tokenClientRef.current = google.accounts.oauth2.initTokenClient({
        client_id: CLIENT_ID,
        scope: SCOPES,
        prompt: '',
        callback: async (response: any) => {
          if (response.error) {
            console.error('OAuth error:', response.error);
            // If this was a silent reauth attempt, reject the promise
            if (reauthRejectRef.current) {
              reauthRejectRef.current(new Error(`OAuth error: ${response.error}`));
              reauthResolveRef.current = null;
              reauthRejectRef.current = null;
            }
            return;
          }

          const newToken = response.access_token;
          setToken(newToken);

          // Fetch user info (skip if this is a background reauth — use cached user)
          if (reauthResolveRef.current) {
            // Silent reauth: resolve the promise with the new token and update cache
            // Re-use the existing cached user info to avoid an extra network call
            const cachedUser = loadCachedAuth()?.user;
            if (cachedUser) {
              saveCachedAuth(newToken, cachedUser, response.expires_in || 3600);
            }
            reauthResolveRef.current(newToken);
            reauthResolveRef.current = null;
            reauthRejectRef.current = null;
          } else {
            // Normal login: fetch user info
            try {
              const res = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
                headers: { Authorization: `Bearer ${newToken}` },
              });
              const info = await res.json();
              const userInfo: UserInfo = {
                email: info.email,
                name: info.name,
                picture: info.picture,
              };
              setUser(userInfo);
              saveCachedAuth(newToken, userInfo, response.expires_in || 3600);
            } catch (err) {
              console.error('Failed to fetch user info:', err);
            }
          }
        },
        error_callback: (error: any) => {
          console.error('Token client error:', error);
          // If this was a silent reauth attempt, reject the promise
          if (reauthRejectRef.current) {
            reauthRejectRef.current(new Error(`Token client error: ${error?.type || error?.message || 'unknown'}`));
            reauthResolveRef.current = null;
            reauthRejectRef.current = null;
          }
        },
      });
    };

    init();

    // Register the reauth callback so sheets.ts can trigger silent re-auth on 401
    const unregisterReauth = registerReauthCallback(() => {
      return new Promise<string>((resolve, reject) => {
        if (!tokenClientRef.current) {
          reject(new Error('GIS token client not initialized'));
          return;
        }
        reauthResolveRef.current = resolve;
        reauthRejectRef.current = reject;
        // Request a new token silently (prompt: '' skips consent screen)
        tokenClientRef.current.requestAccessToken({ prompt: '' });
      });
    });

    // Register the reauth-failed callback — clears auth state and shows login
    const unregisterFailed = onReauthFailed(() => {
      clearCachedAuth();
      setToken(null);
      setUser(null);
      showToast('Session expired — please sign in again', 'error');
    });

    return () => {
      unregisterReauth();
      unregisterFailed();
    };
  }, []);

  const login = useCallback(() => {
    tokenClientRef.current?.requestAccessToken();
  }, []);

  const logout = useCallback(() => {
    // Don't revoke the token — that removes the consent grant and forces
    // the full consent flow on next login. Just clear local state.
    clearCachedAuth();
    setToken(null);
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider
      value={{
        token,
        user,
        isAuthenticated: !!token,
        login,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

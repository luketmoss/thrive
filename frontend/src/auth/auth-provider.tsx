import { useState, useEffect, useCallback, useRef } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import { AuthContext } from './auth-context';
import type { UserInfo } from '../api/types';
import { registerReauthCallback, onReauthFailed, attemptReauth } from './reauth';
import { onPageVisible } from '../state/page-visible';
import { isDemo } from '../api/demo-data';

const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID;
const SCOPES = 'https://www.googleapis.com/auth/spreadsheets openid email profile';

const TOKEN_KEY = 'gw_token';
const USER_KEY = 'gw_user';
const TOKEN_EXPIRY_KEY = 'gw_token_expiry';

/** #353: renew from the next tap once the token is this close to expiring. */
export const RENEW_AHEAD_MS = 10 * 60 * 1000;

export function loadCachedAuth(): { token: string; user: UserInfo; expiry: number } | null {
  try {
    const token = localStorage.getItem(TOKEN_KEY);
    const user = localStorage.getItem(USER_KEY);
    const expiry = localStorage.getItem(TOKEN_EXPIRY_KEY);
    if (token && user && expiry && Date.now() < Number(expiry)) {
      return { token, user: JSON.parse(user), expiry: Number(expiry) };
    }
    // Expired or missing — drop the token but keep the user (#353), so the
    // login screen can offer "Continue as <email>" instead of a bare sign-in.
    clearCachedToken();
  } catch { /* ignore */ }
  return null;
}

/** #353: the user a previous sign-in left behind, or null. Holds no secret. */
export function loadRememberedUser(): UserInfo | null {
  try {
    const user = localStorage.getItem(USER_KEY);
    return user ? (JSON.parse(user) as UserInfo) : null;
  } catch {
    return null;
  }
}

/** Drop the token and its expiry; the remembered user stays (#353). */
export function clearCachedToken() {
  try {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(TOKEN_EXPIRY_KEY);
  } catch { /* ignore */ }
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

const RENEW_FAILED = 'Could not sign you in. Try again, or use a different account.';

/** `hint` is GIS's current name for the account hint; `login_hint` its older one. */
function hintFor(user: UserInfo | null): { hint?: string; login_hint?: string } {
  return user?.email ? { hint: user.email, login_hint: user.email } : {};
}

interface Props {
  children: ComponentChildren;
}

const DEMO_USER: UserInfo = { email: 'demo@thrive.app', name: 'Demo User', picture: '' };

export function AuthProvider({ children }: Props) {
  const demo = isDemo();
  const cached = demo ? null : loadCachedAuth();
  const [token, setToken] = useState<string | null>(demo ? 'demo' : (cached?.token ?? null));
  const [user, setUser] = useState<UserInfo | null>(demo ? DEMO_USER : (cached?.user ?? null));
  const tokenClientRef = useRef<any>(null);
  const [ready, setReady] = useState(false);
  const [renewing, setRenewing] = useState(false);
  const [renewError, setRenewError] = useState<string | null>(null);
  // Token expiry (ms epoch) as last cached; drives the touch-armed renewal (#353).
  const expiryRef = useRef<number | null>(cached?.expiry ?? null);
  const userRef = useRef<UserInfo | null>(demo ? DEMO_USER : (cached?.user ?? loadRememberedUser()));
  const [rememberedUser, setRememberedUser] = useState<UserInfo | null>(
    demo || cached ? null : loadRememberedUser(),
  );

  // Demo mode: skip GIS entirely — provide fake auth context
  if (demo) {
    return (
      <AuthContext.Provider
        value={{
          token: 'demo',
          user: DEMO_USER,
          isAuthenticated: true,
          login: () => {},
          logout: () => {},
          rememberedUser: null,
          ready: true,
          renewing: false,
          renewError: null,
          continueAs: () => {},
        }}
      >
        {children}
      </AuthContext.Provider>
    );
  }

  /**
   * Pending reauth resolver. When a silent re-auth is triggered by a 401
   * in sheets.ts, we store the resolve/reject pair here so the GIS callback
   * can settle the promise returned to the API layer.
   */
  const reauthResolveRef = useRef<((token: string) => void) | null>(null);
  const reauthRejectRef = useRef<((err: Error) => void) | null>(null);
  const scheduleTouchRenewalRef = useRef<() => void>(() => {});
  const scheduleTouchRenewal = () => scheduleTouchRenewalRef.current();

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
          setRenewing(false);
          if (response.error) {
            console.error('OAuth error:', response.error);
            setRenewError(RENEW_FAILED);
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
          setRenewError(null);
          expiryRef.current = Date.now() + ((response.expires_in || 3600) - 60) * 1000;
          scheduleTouchRenewal();

          // Fetch user info (skip if this is a background reauth — use cached user)
          if (reauthResolveRef.current) {
            // Silent reauth: resolve the promise with the new token and update cache
            // Re-use the user we already know to avoid an extra network call.
            // Not loadCachedAuth(): it returns null once the stored token has
            // expired, which is exactly when a renewal arrives (#353).
            const cachedUser = userRef.current ?? loadRememberedUser();
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
              userRef.current = userInfo;
              saveCachedAuth(newToken, userInfo, response.expires_in || 3600);
            } catch (err) {
              console.error('Failed to fetch user info:', err);
            }
          }
        },
        error_callback: (error: any) => {
          console.error('Token client error:', error);
          setRenewing(false);
          // popup_failed_to_open / popup_closed from a Continue tap (#353)
          setRenewError(RENEW_FAILED);
          // If this was a silent reauth attempt, reject the promise
          if (reauthRejectRef.current) {
            reauthRejectRef.current(new Error(`Token client error: ${error?.type || error?.message || 'unknown'}`));
            reauthResolveRef.current = null;
            reauthRejectRef.current = null;
          }
        },
      });
      setReady(true);
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
        tokenClientRef.current.requestAccessToken({ prompt: '', ...hintFor(userRef.current) });
      });
    });

    // Register the reauth-failed callback — drops the token and shows the
    // Continue screen; the user is kept so one tap gets back in (#353).
    const unregisterFailed = onReauthFailed(() => {
      clearCachedToken();
      expiryRef.current = null;
      setToken(null);
      setRememberedUser(userRef.current);
      setRenewError(null);
    });

    // #353: GIS renews through a popup the browser only allows from a real tap,
    // so an expiring token is renewed by the next `pointerup` (touch grants popup
    // activation on release, not press), never by a timer
    // or a 401. Armed when the token nears expiry and when the page returns to
    // the foreground; one-shot; a failure here leaves the old token alone.
    let armed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const needsRenewal = () =>
      expiryRef.current !== null && Date.now() >= expiryRef.current - RENEW_AHEAD_MS;
    const onTouch = () => {
      armed = false;
      if (!needsRenewal() || !tokenClientRef.current) return;
      attemptReauth({ quiet: true })
        .then(() => scheduleTouchRenewal())
        .catch(() => { /* old token still works; the next foreground or 401 deals with it */ });
    };
    const armTouchRenewal = () => {
      if (armed || !needsRenewal()) return;
      armed = true;
      document.addEventListener('pointerup', onTouch, { once: true, capture: true });
    };
    scheduleTouchRenewalRef.current = () => {
      clearTimeout(timer);
      if (expiryRef.current === null) return;
      timer = setTimeout(armTouchRenewal, Math.max(0, expiryRef.current - RENEW_AHEAD_MS - Date.now()));
    };
    scheduleTouchRenewal();
    armTouchRenewal();
    const unsubscribeVisible = onPageVisible(armTouchRenewal);

    return () => {
      unregisterReauth();
      unregisterFailed();
      unsubscribeVisible();
      clearTimeout(timer);
      document.removeEventListener('pointerup', onTouch, { capture: true });
    };
  }, []);

  const login = useCallback(() => {
    tokenClientRef.current?.requestAccessToken();
  }, []);

  // #353: runs from a tap on "Continue as <email>", so the popup is allowed.
  const continueAs = useCallback(() => {
    if (!tokenClientRef.current) return;
    setRenewError(null);
    setRenewing(true);
    tokenClientRef.current.requestAccessToken({ prompt: '', ...hintFor(userRef.current) });
  }, []);

  const logout = useCallback(() => {
    // Don't revoke the token — that removes the consent grant and forces
    // the full consent flow on next login. Just clear local state.
    clearCachedAuth();
    expiryRef.current = null;
    userRef.current = null;
    setToken(null);
    setUser(null);
    setRememberedUser(null);
  }, []);

  return (
    <AuthContext.Provider
      value={{
        token,
        user,
        isAuthenticated: !!token,
        login,
        logout,
        rememberedUser: token ? null : rememberedUser,
        ready,
        renewing,
        renewError,
        continueAs,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

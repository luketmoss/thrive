import { createContext } from 'preact';
import { useContext } from 'preact/hooks';
import type { UserInfo } from '../api/types';

export interface AuthState {
  token: string | null;
  user: UserInfo | null;
  isAuthenticated: boolean;
  login: () => void;
  logout: () => void;
  /** #353: the signed-out user the device remembers, for "Continue as <email>". */
  rememberedUser?: UserInfo | null;
  /** The GIS token client exists, so a sign-in tap will do something. */
  ready?: boolean;
  /** A Continue renewal is in flight. */
  renewing?: boolean;
  /** Words for the last failed Continue, or null. */
  renewError?: string | null;
  /** Renew for `rememberedUser` from a tap, with no account chooser. */
  continueAs?: () => void;
}

export const AuthContext = createContext<AuthState>({
  token: null,
  user: null,
  isAuthenticated: false,
  login: () => {},
  logout: () => {},
  rememberedUser: null,
  ready: false,
  renewing: false,
  renewError: null,
  continueAs: () => {},
});

export function useAuth(): AuthState {
  return useContext(AuthContext);
}

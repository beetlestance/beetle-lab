import { createContext, useContext } from 'react';
import type { BrowserSession, RestoredBackup } from '@beetle/contracts/api';

/**
 * The verified browser session's access facts, read once by the session gate
 * before App mounts. Features consume these instead of reading the session; the
 * CSRF token and expiry never enter this context.
 */
export interface SessionAccess {
  readOnly: boolean;
  restoredBackup: RestoredBackup | null;
  liveOrigin?: string | undefined;
  /** Ends this browser's session; absent when App runs without a session gate. */
  signOut?: (() => void) | undefined;
}

/** Composition tests that mount App without a session gate get an ordinary writable session. */
export const writableSession: SessionAccess = Object.freeze({ readOnly: false, restoredBackup: null });

export const SessionContext = createContext<SessionAccess>(writableSession);

export function sessionAccess(session: BrowserSession, signOut?: () => void): SessionAccess {
  const readOnly = session.readOnly === true;
  return {
    readOnly,
    restoredBackup: session.restoredBackup ?? null,
    ...(readOnly && session.liveOrigin ? { liveOrigin: session.liveOrigin } : {}),
    signOut,
  };
}

export function useSessionAccess(): SessionAccess {
  return useContext(SessionContext);
}

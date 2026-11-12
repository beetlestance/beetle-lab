import { createLocalSession } from '../adapters/inbound/http/session/index.js';
import type { LocalSessionStore } from '../ports/local-session.js';
/** Programmatic clients retain explicit pairing unless automatic access is chosen. */
export function captureLocalAccess(value: unknown): 'paired' | 'automatic' {
  if (value === undefined || value === 'paired') return 'paired';
  if (value === 'automatic') return value;
  throw new TypeError('Invalid local access profile');
}
/** The metadata owner is already open/exclusive before credential restoration. */
export async function openApplicationSession(externalOrigin: string, mode: 'paired' | 'automatic', store: LocalSessionStore) {
  const automatic = mode === 'automatic' ? {initial: await store.load(), store} : undefined;
  return createLocalSession({externalOrigin, ...(automatic ? {automatic} : {})});
}

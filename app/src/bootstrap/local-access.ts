import type { LocalSessionOptions, OriginAccess } from '../adapters/inbound/http/session/index.js';
import { createLocalSession } from '../adapters/inbound/http/session/index.js';
import type { LocalSessionStore } from '../ports/local-session.js';
/** Programmatic clients retain explicit pairing unless automatic access is chosen. */
export function captureLocalAccess(value: unknown): 'paired' | 'automatic' {
  if (value === undefined || value === 'paired') return 'paired';
  if (value === 'automatic') return value;
  throw new TypeError('Invalid local access profile');
}
/** Local unless network access (decision 032) is chosen explicitly. */
export function captureOriginAccess(value: unknown): OriginAccess {
  if (value === undefined || value === 'local') return 'local';
  if (value === 'network') return value;
  throw new TypeError('Invalid origin access');
}
/** The metadata owner is already open/exclusive before credential restoration. */
export async function openApplicationSession(
  externalOrigin: string,
  mode: 'paired' | 'automatic',
  store: LocalSessionStore,
  historical?: Pick<LocalSessionOptions, 'readOnly' | 'cookieName' | 'restoredBackup' | 'liveOrigin'>,
  access?: OriginAccess,
) {
  const automatic = mode === 'automatic' ? { initial: await store.load(), store } : undefined;
  return createLocalSession({
    ...historical,
    externalOrigin,
    ...(access ? { access } : {}),
    ...(automatic ? { automatic } : {}),
  });
}

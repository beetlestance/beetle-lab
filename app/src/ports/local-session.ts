/** Private installation credential state; never a public API resource or log value. */
import type { LocalSessionRecord, StoredBrowserSession } from '../domain/local-session/index.js';
export type { LocalSessionRecord, StoredBrowserSession } from '../domain/local-session/index.js';
export type LocalSessionOperation = {readonly kind: 'loadLocalSession'}
  | {readonly kind: 'saveLocalSession'; readonly expectedVersion: number; readonly session: StoredBrowserSession | null};
export interface LocalSessionStore {
  load(): Promise<LocalSessionRecord>;
  save(expectedVersion: number, session: StoredBrowserSession | null): Promise<LocalSessionRecord>;
}

import { encodeJson } from '@beetle/contracts';
import { validateApi } from '@beetle/contracts/api';
import { requireRule } from '../namespaces/index.js';
export interface StoredBrowserSession {readonly cookie: string; readonly csrfToken: string; readonly issuedAt: string; readonly expiresAt: string}
export interface LocalSessionRecord {readonly version: number; readonly session: StoredBrowserSession | null}
export const LOCAL_SESSION_MS = 8 * 60 * 60_000;
function closed(value: unknown, keys: readonly string[]): asserts value is Record<string, unknown> {
  requireRule(value !== null && typeof value === 'object' && !Array.isArray(value));
  requireRule(Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key)));
}
export function captureStoredSession(input: unknown): StoredBrowserSession | null {
  const value: unknown = JSON.parse(encodeJson(input, 1024)); if (value === null) return null;
  closed(value, ['cookie','csrfToken','issuedAt','expiresAt']);
  requireRule(typeof value.cookie === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value.cookie));
  requireRule(typeof value.csrfToken === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value.csrfToken) && value.csrfToken !== value.cookie);
  requireRule(validateApi('RunTimestamp', value.issuedAt).ok && validateApi('RunTimestamp', value.expiresAt).ok);
  requireRule(Date.parse(value.expiresAt as string) - Date.parse(value.issuedAt as string) === LOCAL_SESSION_MS);
  return Object.freeze(value as unknown as StoredBrowserSession);
}
export function captureSessionRecord(input: unknown): LocalSessionRecord {
  if (input && typeof input === 'object') requireRule(!Object.is(Object.getOwnPropertyDescriptor(input, 'version')?.value, -0));
  const value: unknown = JSON.parse(encodeJson(input, 2048)); closed(value, ['version','session']);
  requireRule(typeof value.version === 'number' && Number.isSafeInteger(value.version) && value.version >= 0 && !Object.is(value.version, -0));
  requireRule(value.version !== 0 || value.session === null);
  return Object.freeze({version: value.version, session: captureStoredSession(value.session)});
}

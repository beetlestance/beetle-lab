import { encodeCanonicalJson } from '@beetle/contracts';
import type { DatabaseSync } from 'node:sqlite';
import type { LocalSessionOperation, LocalSessionRecord } from '../../../../ports/local-session.js';
import { captureSessionRecord, captureStoredSession } from '../../../../domain/local-session/index.js';
import { requireRule } from '../../../../domain/namespaces/index.js';
import { boundedCopy } from '../input-values.js';
import { StorageError } from '../protocol.js';
import { transaction } from '../transaction.js';
export function localSessionOperation(input: unknown): input is LocalSessionOperation {
  const descriptor = input && typeof input === 'object' ? Object.getOwnPropertyDescriptor(input, 'kind') : undefined;
  return !!descriptor && 'value' in descriptor && ['loadLocalSession','saveLocalSession'].includes(descriptor.value as string);
}
export function captureLocalSessionOperation(input: unknown): LocalSessionOperation {
  rejectRawNegativeVersion(input);
  const value = boundedCopy(input, 2048) as LocalSessionOperation & {messageId?: number}; requireRule(localSessionOperation(value));
  const keys = ['kind', ...(value.kind === 'saveLocalSession' ? ['expectedVersion','session'] : []), ...(Object.hasOwn(value, 'messageId') ? ['messageId'] : [])];
  requireRule(Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key)));
  if (Object.hasOwn(value, 'messageId')) requireRule(Number.isSafeInteger(value.messageId) && value.messageId! > 0);
  if (value.kind === 'loadLocalSession') return {kind: value.kind};
  requireRule(Number.isSafeInteger(value.expectedVersion) && value.expectedVersion >= 0 && value.expectedVersion < Number.MAX_SAFE_INTEGER && !Object.is(value.expectedVersion, -0));
  return {kind: value.kind, expectedVersion: value.expectedVersion, session: captureStoredSession(value.session)};
}
export function captureLocalSessionReply(operation: LocalSessionOperation, input: unknown): LocalSessionRecord {
  const value = captureSessionRecord(input);
  if (operation.kind === 'saveLocalSession') requireRule(value.version === operation.expectedVersion + 1
    && encodeCanonicalJson(value.session, 1024) === encodeCanonicalJson(operation.session, 1024));
  return value;
}
export class LocalSessions {
  constructor(private readonly db: DatabaseSync) {}
  execute(input: LocalSessionOperation): LocalSessionRecord {
    const operation = captureLocalSessionOperation(input);
    return transaction(this.db, () => captureLocalSessionReply(operation, this.change(operation)));
  }
  private load(): LocalSessionRecord {
    const row = this.db.prepare('SELECT version,session_json FROM local_browser_session WHERE id=1').get();
    return captureSessionRecord(row ? {version: row.version, session: row.session_json === null ? null : JSON.parse(row.session_json as string)} : {version: 0, session: null});
  }
  private change(operation: LocalSessionOperation): LocalSessionRecord {
    const current = this.load(); if (operation.kind === 'loadLocalSession') return current;
    const json = operation.session === null ? null : encodeCanonicalJson(operation.session, 1024);
    if (current.version === operation.expectedVersion + 1 && encodeCanonicalJson(current.session, 1024) === encodeCanonicalJson(operation.session, 1024)) return current;
    if (current.version !== operation.expectedVersion) throw new StorageError('conflict');
    if (current.version === 0) this.db.prepare('INSERT INTO local_browser_session(id,version,session_json) VALUES(1,1,?)').run(json);
    else this.db.prepare('UPDATE local_browser_session SET version=version+1,session_json=? WHERE id=1').run(json);
    return this.load();
  }
}

/** JSON encoding normalizes negative zero; inspect that one numeric field first. */
function rejectRawNegativeVersion(input: unknown): void {
  if (input && typeof input === 'object') requireRule(!Object.is(Object.getOwnPropertyDescriptor(input, 'expectedVersion')?.value, -0));
}

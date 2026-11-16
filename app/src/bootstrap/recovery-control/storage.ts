import { LocalSessions, localBrowserSessionSchema } from '../../adapters/outbound/sqlite/local-session/index.js';
import type { LocalSessionStore } from '../../ports/local-session.js';
import { DatabaseSync } from 'node:sqlite';
import { ControlFiles } from './files.js';
import { identifier, RecoveryControlError, state } from './types.js';
import type { RecoveryState } from './types.js';
interface Owner {db?: DatabaseSync; file?: ControlFiles; closeState: 'open' | 'closed' | 'failed'; failure?: RecoveryControlError}
const owners = new Map<string, Owner>();
const schema = `CREATE TABLE recovery_control(
 id INTEGER PRIMARY KEY CHECK(id=1), installation_id TEXT NOT NULL, purpose TEXT NOT NULL CHECK(purpose IN ('installation','history')),
 phase TEXT NOT NULL CHECK(phase IN ('initializing','ready','restoring','historical')), operation_id TEXT, manifest_digest TEXT, attestation_digest TEXT,
 CHECK((phase='ready' AND purpose='installation') OR phase!='ready'),
 CHECK((phase='historical' AND purpose='history') OR phase!='historical'),
 CHECK((phase IN ('initializing','ready') AND operation_id IS NULL AND manifest_digest IS NULL AND attestation_digest IS NULL)
 OR (phase='restoring' AND length(operation_id)=36 AND length(manifest_digest)=64 AND attestation_digest IS NULL)
 OR (phase='historical' AND length(operation_id)=36 AND length(manifest_digest)=64 AND length(attestation_digest)=64))
);
CREATE TRIGGER purpose_is_permanent BEFORE UPDATE OF purpose ON recovery_control BEGIN SELECT RAISE(ABORT,'purpose retained'); END;
CREATE TRIGGER historical_is_permanent BEFORE UPDATE ON recovery_control WHEN OLD.phase='historical' BEGIN SELECT RAISE(ABORT,'historical state retained'); END;
${localBrowserSessionSchema}
PRAGMA user_version=1;`;
/** One retained offline/startup lease; no per-request or per-job writes. */
export class BackendControl {
  private closed = false;
  private constructor(private readonly path: string, private readonly db: DatabaseSync,
    private readonly file: ControlFiles, private readonly installationId: string, private readonly owner: Owner) {}
  static open(path: string, installationId: string, create = false, restore?: Extract<RecoveryState, {phase: 'restoring' | 'historical'}>): BackendControl {
    return BackendControl.acquire({path, installationId, create, ...(restore ? {restore} : {})});
  }
  static readOnly(path: string, installationId: string): BackendControl {
    return BackendControl.acquire({path, installationId, create: false, readOnly: true});
  }
  private static acquire(input: {path: string; installationId: string; create: boolean; restore?: Extract<RecoveryState, {phase: 'restoring' | 'historical'}>; readOnly?: true}): BackendControl {
    const {path, installationId, create, restore, readOnly} = input;
    identifier(installationId);
    if (owners.has(path)) throw new RecoveryControlError('owned');
    const owner: Owner = {closeState: 'open'}; owners.set(path, owner);
    try {
      const file = new ControlFiles(path); owner.file = file; file.acquire(create, readOnly);
      const db = new DatabaseSync(path, {timeout: 100, readOnly: readOnly === true}); owner.db = db; file.check();
      if (readOnly) BackendControl.configureReadOnly(db); else BackendControl.configure(db, create, installationId, restore);
      if (create) {
        file.syncParent();
        if (!restore) {const ready = db.prepare("UPDATE recovery_control SET phase='ready' WHERE id=1 AND phase='initializing'").run();
        if (ready.changes !== 1) throw new RecoveryControlError('recovery_required');}
      }
      const lease = new BackendControl(path, db, file, installationId, owner); lease.snapshot(); return lease;
    } catch (cause) {
      BackendControl.failedOpen(path, owner, cause);
    }
  }
  private static failedOpen(path: string, owner: Owner, cause: unknown): never {
    closeOwner(owner);
    if (owners.get(path) === owner) owners.delete(path);
    throw translated(cause);
  }
  private static configureReadOnly(db: DatabaseSync): void {
    db.exec('PRAGMA query_only=ON; PRAGMA busy_timeout=100; PRAGMA cache_size=-64; PRAGMA mmap_size=0;');
    if (db.prepare('PRAGMA user_version').get()?.user_version !== 1) throw new RecoveryControlError('recovery_required');
    const pages = db.prepare('PRAGMA page_count').get()?.page_count;
    if (typeof pages !== 'number' || pages > 16) throw new RecoveryControlError('recovery_required');
  }
  private static configure(db: DatabaseSync, create: boolean, installationId: string, restore?: Extract<RecoveryState, {phase: 'restoring' | 'historical'}>): void {
    if (db.prepare('PRAGMA journal_mode').get()?.journal_mode !== 'delete') throw new RecoveryControlError('recovery_required');
    db.exec('PRAGMA busy_timeout=100; PRAGMA cache_size=-64; PRAGMA mmap_size=0; PRAGMA synchronous=EXTRA; PRAGMA locking_mode=EXCLUSIVE; BEGIN EXCLUSIVE; COMMIT;');
    if (create) BackendControl.initialize(db, installationId, restore);
    if (db.prepare('PRAGMA user_version').get()?.user_version !== 1) throw new RecoveryControlError('recovery_required');
    db.exec('PRAGMA max_page_count=16;');
    for (const [key, expected] of Object.entries({journal_mode: 'delete', page_size: 4096, max_page_count: 16, cache_size: -64, mmap_size: 0, synchronous: 3, locking_mode: 'exclusive'})) {
      if (db.prepare(`PRAGMA ${key}`).get()?.[key] !== expected) throw new RecoveryControlError('recovery_required');
    }
  }
  private static initialize(db: DatabaseSync, installationId: string, restore?: Extract<RecoveryState, {phase: 'restoring' | 'historical'}>): void {
    const record = restore ?? {purpose: 'installation', phase: 'initializing', operationId: null, manifestDigest: null, attestationDigest: null};
    db.exec('PRAGMA page_size=4096; PRAGMA max_page_count=16; BEGIN EXCLUSIVE;');
    try {
      db.exec(schema); db.prepare('INSERT INTO recovery_control VALUES(1,?,?,?,?,?,?)').run(installationId,
        record.purpose, record.phase, record.operationId, record.manifestDigest, record.attestationDigest); db.exec('COMMIT;');
    } catch (error) {db.exec('ROLLBACK;'); throw error;}
  }
  snapshot(): RecoveryState {
    if (this.closed) throw new RecoveryControlError('closed');
    if (this.owner.closeState === 'failed') throw this.owner.failure;
    this.file.check();
    const rows = this.db.prepare(`SELECT id, CASE WHEN purpose IN ('installation','history') THEN purpose END purpose, CASE WHEN length(CAST(installation_id AS BLOB))=36 THEN installation_id END installationId,
      CASE WHEN length(CAST(phase AS BLOB))<=10 THEN phase END phase,
      CASE WHEN operation_id IS NULL THEN NULL WHEN length(CAST(operation_id AS BLOB))=36 THEN operation_id END operationId,
      CASE WHEN manifest_digest IS NULL THEN NULL WHEN length(CAST(manifest_digest AS BLOB))=64 THEN manifest_digest END manifestDigest,
      CASE WHEN attestation_digest IS NULL THEN NULL WHEN length(CAST(attestation_digest AS BLOB))=64 THEN attestation_digest END attestationDigest
      FROM recovery_control LIMIT 2`).all();
    if (rows.length !== 1 || rows[0]?.id !== 1 || rows[0].installationId !== this.installationId) throw new RecoveryControlError('recovery_required');
    return state(rows[0]);
  }
  transition(from: RecoveryState, to: RecoveryState): void {
    this.snapshot(); state(to);
    if (from.purpose !== to.purpose) throw new RecoveryControlError('recovery_required');
    const result = this.db.prepare(`UPDATE recovery_control SET phase=?,operation_id=?,manifest_digest=?,attestation_digest=? WHERE id=1
      AND phase=? AND operation_id IS ? AND manifest_digest IS ? AND attestation_digest IS ?`).run(to.phase, to.operationId, to.manifestDigest, to.attestationDigest, from.phase, from.operationId, from.manifestDigest, from.attestationDigest);
    if (result.changes !== 1) throw new RecoveryControlError('recovery_required');
  }
  sessions(): LocalSessionStore {
    const current = this.snapshot();
    if (current.phase !== 'historical') throw new RecoveryControlError('recovery_required');
    const sessions = new LocalSessions(this.db);
    return Object.freeze({load: async () => {this.snapshot(); return sessions.execute({kind: 'loadLocalSession'});},
      save: async (expectedVersion: number, session: Parameters<LocalSessionStore['save']>[1]) => {
        this.snapshot(); return sessions.execute({kind: 'saveLocalSession', expectedVersion, session});
      }});
  }
  close(): void {
    if (this.closed) return;
    closeOwner(this.owner); this.closed = true;
    if (owners.get(this.path) === this.owner) owners.delete(this.path);
  }
}

function translated(cause: unknown): RecoveryControlError {
  if (cause instanceof RecoveryControlError) return cause;
  if (cause && typeof cause === 'object' && 'errcode' in cause && [5, 6].includes(Number(cause.errcode))) return new RecoveryControlError('owned');
  return new RecoveryControlError('recovery_required');
}

function closeOwner(owner: Owner): void {
  if (owner.closeState === 'closed') return;
  if (owner.closeState === 'failed') throw owner.failure;
  owner.closeState = 'failed'; owner.failure = new RecoveryControlError('cleanup');
  try {owner.db?.close(); owner.file?.close();}
  catch {throw owner.failure;}
  owner.closeState = 'closed';
}

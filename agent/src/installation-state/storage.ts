import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { capturedState, InstallationStateError } from './types.js';
import type { State } from './types.js';
import { ControlFiles } from './files.js';
import { schema } from './schema.js';

function translated(error: unknown): InstallationStateError {
  if (error instanceof InstallationStateError) return error;
  if (typeof error === 'object' && error !== null && 'errcode' in error && (error.errcode === 5 || error.errcode === 6)) {
    return new InstallationStateError('owned');
  }
  return new InstallationStateError('recovery_required');
}
function verifyPragmas(db: DatabaseSync): void {
  const required = { locking_mode: 'exclusive', synchronous: 3, cache_size: -64,
    mmap_size: 0, max_page_count: 16, page_size: 4096 };
  for (const [name, value] of Object.entries(required)) {
    if (db.prepare(`PRAGMA ${name}`).get()?.[name] !== value) throw new InstallationStateError('recovery_required');
  }
}
interface Owner {db?: DatabaseSync; file?: ControlFiles; closeState: 'open' | 'closed' | 'failed'; failure?: InstallationStateError}
let processOwner: Owner | undefined;

/** One tiny synchronous startup/control store; never used per job/event/sample. */
export class ControlStore {
  private closed = false;
  private constructor(private readonly db: DatabaseSync, private readonly file: ControlFiles, private readonly owner: Owner) {}
  static open(path: string, create: boolean): ControlStore {
    if (processOwner !== undefined) throw new InstallationStateError('owned');
    const owned: Owner = {closeState: 'open'}; processOwner = owned;
    try {
      const file = new ControlFiles(path); owned.file = file; file.acquire(create);
      const db = new DatabaseSync(path, { timeout: 100 }); owned.db = db; file.check();
      ControlStore.configure(db, create);
      const owner = new ControlStore(db, file, owned); owner.snapshot();
      if (create) file.syncParent();
      return owner;
    } catch (error) {
      ControlStore.failedOpen(owned, error);
      throw translated(error);
    }
  }
  private static failedOpen(owned: Owner, error: unknown): never {
    closeOwned(owned);
    if (processOwner === owned) processOwner = undefined;
    throw translated(error);
  }
  private static configure(db: DatabaseSync, create: boolean): void {
    if (db.prepare('PRAGMA journal_mode').get()?.journal_mode !== 'delete') throw new InstallationStateError('recovery_required');
    db.exec('PRAGMA busy_timeout=100; PRAGMA cache_size=-64; PRAGMA mmap_size=0; PRAGMA synchronous=EXTRA; PRAGMA locking_mode=EXCLUSIVE; BEGIN EXCLUSIVE; COMMIT;');
    if (create) ControlStore.initialize(db);
    if (db.prepare('PRAGMA user_version').get()?.user_version !== 1) throw new InstallationStateError('recovery_required');
    if (db.prepare('PRAGMA page_size').get()?.page_size !== 4096) throw new InstallationStateError('recovery_required');
    db.exec('PRAGMA max_page_count=16;'); verifyPragmas(db);
  }
  private static initialize(db: DatabaseSync): void {
    db.exec('PRAGMA journal_mode=DELETE; PRAGMA page_size=4096; PRAGMA max_page_count=16; BEGIN EXCLUSIVE;');
    try {
      db.exec(schema); db.prepare("INSERT INTO installation_state(id,phase,operation_id) VALUES(1,'initializing',?)").run(randomUUID());
      db.exec('COMMIT;');
    } catch (error) { db.exec('ROLLBACK;'); throw error; }
  }
  private check(): void {
    if (this.closed) throw new InstallationStateError('closed');
    if (this.owner.closeState === 'failed') throw this.owner.failure;
    this.file.check();
  }
  snapshot(): Readonly<State> {
    this.check();
    try {
      const rows = this.db.prepare(`SELECT CASE WHEN typeof(id)='integer' AND id=1 THEN 1 ELSE 0 END id,
        CASE WHEN length(CAST(phase AS BLOB))<=12 THEN phase END phase,
        CASE WHEN operation_id IS NULL THEN NULL WHEN length(CAST(operation_id AS BLOB))=36 THEN operation_id ELSE '!' END operationId,
        CASE WHEN authority IS NULL THEN NULL WHEN length(CAST(authority AS BLOB))=36 THEN authority ELSE '!' END authority,
        CASE WHEN pending IS NULL THEN NULL WHEN length(CAST(pending AS BLOB))=36 THEN pending ELSE '!' END pending FROM installation_state LIMIT 2`).all();
      if (rows.length !== 1 || rows[0]?.id !== 1) throw new InstallationStateError('recovery_required');
      return capturedState(rows[0]);
    } catch (error) { throw translated(error); }
  }
  transition(previous: State['phase'], next: Readonly<State>): void {
    this.check(); capturedState(next);
    try {
      const result = this.db.prepare('UPDATE installation_state SET phase=?,operation_id=?,authority=?,pending=? WHERE id=1 AND phase=?')
        .run(next.phase, next.operationId, next.authority, next.pending, previous);
      if (result.changes !== 1) throw new InstallationStateError('recovery_required');
    } catch (error) { throw translated(error); }
  }
  close(): void {
    if (this.closed) return;
    closeOwned(this.owner); this.closed = true;
    if (processOwner === this.owner) processOwner = undefined;
  }
}

function closeOwned(owner: Owner): void {
  if (owner.closeState === 'closed') return;
  if (owner.closeState === 'failed') throw owner.failure;
  owner.closeState = 'failed'; owner.failure = new InstallationStateError('unavailable');
  try {owner.db?.close(); owner.file?.close();} catch {throw owner.failure;}
  owner.closeState = 'closed';
}

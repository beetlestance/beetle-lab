import { DatabaseSync } from 'node:sqlite';
import type { StatementSync } from 'node:sqlite';
import { parentPort, workerData } from 'node:worker_threads';
import type { AttemptSnapshot, Offer } from '@beetle/contracts';
import { offerInput } from './input.js';
import type { AttemptKey, Command, ErrorCode, Reply, Value } from './protocol.js';

const port = parentPort;
if (!port) throw new Error('Journal worker required');
interface Row {
  id: number; attempt_id: string; organization_id: string; workspace_id: string;
  intent_digest: string; generation: number; state: 'offered'; last_seq: number;
  cancel_requested: number;
}
const columns = 'id, attempt_id, organization_id, workspace_id, intent_digest, generation, state, last_seq, cancel_requested';
const migration001 = `
  CREATE TABLE accepted_attempts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    attempt_id TEXT NOT NULL UNIQUE,
    organization_id TEXT NOT NULL,
    workspace_id TEXT NOT NULL,
    intent_digest TEXT NOT NULL,
    generation INTEGER NOT NULL CHECK(generation = 1),
    state TEXT NOT NULL CHECK(state = 'offered'),
    last_seq INTEGER NOT NULL CHECK(last_seq = 0),
    cancel_requested INTEGER NOT NULL DEFAULT 0 CHECK(cancel_requested IN (0,1)),
    offer_json TEXT NOT NULL CHECK(length(CAST(offer_json AS BLOB)) <= 1048576),
    canonical_json TEXT NOT NULL CHECK(length(CAST(canonical_json AS BLOB)) <= 1048576)
  );
  PRAGMA user_version = 1;
`;
class Failure extends Error { constructor(readonly code: ErrorCode) { super(code); } }

function snapshot(row: Row): AttemptSnapshot {
  return { protocolVersion: '1.0', attemptId: row.attempt_id, organizationId: row.organization_id,
    workspaceId: row.workspace_id, intentDigest: row.intent_digest, generation: row.generation,
    state: row.state, lastSeq: row.last_seq, retainedStartSeq: 0, cancelRequested: row.cancel_requested === 1 };
}

function transaction<T>(db: DatabaseSync, work: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try { const value = work(); db.exec('COMMIT'); return value; }
  catch (error) {
    try { db.exec('ROLLBACK'); } catch { throw new Failure('unavailable'); }
    throw error;
  }
}

function initialize(path: string): DatabaseSync {
  const db = new DatabaseSync(path, { timeout: 100, enableForeignKeyConstraints: true });
  try {
    // Establish and retain the OS SQLite lock before entering WAL mode.
    db.exec('PRAGMA busy_timeout=100; PRAGMA cache_size=-2048; PRAGMA locking_mode=EXCLUSIVE; BEGIN EXCLUSIVE; COMMIT;');
    const version = db.prepare('PRAGMA user_version').get()?.user_version;
    if (typeof version !== 'number' || version > 1) throw new Failure('schema_newer');
    db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON;');
    if (version === 0) transaction(db, () => db.exec(migration001));
    return db;
  } catch (error) { db.close(); throw error; }
}

class Store {
  private readonly byAttempt: StatementSync;
  private readonly scoped: StatementSync;
  private readonly insert: StatementSync;
  private readonly cancel: StatementSync;
  private readonly read: StatementSync;
  private readonly list: StatementSync;

  constructor(private readonly db: DatabaseSync) {
    this.byAttempt = db.prepare(`SELECT ${columns}, canonical_json FROM accepted_attempts WHERE attempt_id=?`);
    this.scoped = db.prepare(`SELECT ${columns} FROM accepted_attempts WHERE attempt_id=? AND organization_id=? AND workspace_id=?`);
    this.insert = db.prepare(`INSERT INTO accepted_attempts
      (attempt_id, organization_id, workspace_id, intent_digest, generation, state, last_seq, offer_json, canonical_json)
      VALUES (?,?,?,?,1,'offered',0,?,?)`);
    this.cancel = db.prepare('UPDATE accepted_attempts SET cancel_requested=1 WHERE attempt_id=? AND organization_id=? AND workspace_id=?');
    this.read = db.prepare(`SELECT CASE WHEN length(CAST(offer_json AS BLOB))<=1048576
      THEN offer_json ELSE NULL END AS offer_json FROM accepted_attempts
      WHERE attempt_id=? AND organization_id=? AND workspace_id=?`);
    this.list = db.prepare(`SELECT ${columns} FROM accepted_attempts WHERE id>? ORDER BY id LIMIT ?`);
  }

  private row(key: AttemptKey): Row {
    const row = this.scoped.get(key.attemptId, key.organizationId, key.workspaceId) as unknown as Row | undefined;
    if (!row) throw new Failure('not_found');
    return row;
  }

  private offer(command: Extract<Command, { kind: 'offer' }>): AttemptSnapshot {
    const offer = JSON.parse(command.json) as Offer;
    const checked = offerInput(offer);
    if (checked.canonical !== command.canonical) throw new Failure('invalid_input');
    return transaction(this.db, () => {
      const existing = this.byAttempt.get(offer.attemptId) as unknown as (Row & { canonical_json: string }) | undefined;
      if (existing) {
        if (existing.canonical_json !== command.canonical) throw new Failure('conflict');
        return snapshot(existing);
      }
      this.insert.run(offer.attemptId, offer.organizationId, offer.workspaceId, offer.intentDigest, command.json, command.canonical);
      return snapshot(this.row(offer));
    });
  }

  private readOffer(key: AttemptKey): Offer {
    this.row(key);
    const json = this.read.get(key.attemptId, key.organizationId, key.workspaceId)?.offer_json;
    if (typeof json !== 'string') throw new Failure('unavailable');
    return JSON.parse(json) as Offer;
  }

  private listOpen(page: { limit: number; cursor?: number }): Value {
    const rows = this.list.all(page.cursor ?? 0, page.limit + 1) as unknown as Row[];
    const more = rows.length > page.limit;
    const snapshots = rows.slice(0, page.limit).map(snapshot);
    const cursor = rows[page.limit - 1]?.id;
    return more && cursor !== undefined ? { snapshots, cursor } : { snapshots };
  }

  execute(command: Command): Value {
    switch (command.kind) {
      case 'offer': return this.offer(command);
      case 'get': return snapshot(this.row(command.key));
      case 'cancel': return transaction(this.db, () => {
        this.row(command.key);
        this.cancel.run(command.key.attemptId, command.key.organizationId, command.key.workspaceId);
        return snapshot(this.row(command.key));
      });
      case 'read': return this.readOffer(command.key);
      case 'list': return this.listOpen(command.page);
      case 'close': this.db.close(); return null;
    }
  }
}

function startupCode(error: unknown): ErrorCode {
  if (error instanceof Failure) return error.code;
  if (typeof error === 'object' && error !== null && 'errcode' in error &&
    (error.errcode === 5 || error.errcode === 6)) return 'owned';
  return 'unavailable';
}

function start(): void {
  let store: Store;
  try {
    const data = workerData as { path: string };
    store = new Store(initialize(data.path));
  } catch (error) { port?.postMessage({ kind: 'startup_error', code: startupCode(error) } satisfies Reply); port?.close(); return; }
  port?.on('message', (command: Command) => {
    try {
      const value = store.execute(command);
      port.postMessage({ kind: 'result', id: command.id, ok: true, value } satisfies Reply);
      if (command.kind === 'close') port.close();
    } catch (error) {
      const code = error instanceof Failure ? error.code : 'unavailable';
      port.postMessage({ kind: 'result', id: command.id, ok: false, code } satisfies Reply);
    }
  });
  port?.postMessage({ kind: 'ready' } satisfies Reply);
}
start();

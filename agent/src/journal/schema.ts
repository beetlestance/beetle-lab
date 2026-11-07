import { DatabaseSync } from 'node:sqlite';
import { Failure, transaction } from './sql.js';
import { migration003 } from './migration003.js';

// Rebuild only the foundation's fixed sequence constraint. Copy immutable JSON and
// row IDs verbatim, including original UUID spellings and durable cancel intent.
export const migration002 = `
  ALTER TABLE accepted_attempts RENAME TO accepted_attempts_v1;
  CREATE TABLE accepted_attempts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    attempt_id TEXT NOT NULL UNIQUE, organization_id TEXT NOT NULL, workspace_id TEXT NOT NULL,
    intent_digest TEXT NOT NULL, generation INTEGER NOT NULL CHECK(generation = 1),
    state TEXT NOT NULL CHECK(state = 'offered'),
    last_seq INTEGER NOT NULL CHECK(last_seq BETWEEN 0 AND 9007199254740990),
    cancel_requested INTEGER NOT NULL DEFAULT 0 CHECK(cancel_requested IN (0,1)),
    offer_json TEXT NOT NULL CHECK(length(CAST(offer_json AS BLOB)) <= 1048576),
    canonical_json TEXT NOT NULL CHECK(length(CAST(canonical_json AS BLOB)) <= 1048576),
    retained_start_seq INTEGER NOT NULL DEFAULT 0 CHECK(retained_start_seq >= 0),
    acknowledged_seq INTEGER NOT NULL DEFAULT 0 CHECK(acknowledged_seq BETWEEN 0 AND last_seq),
    spool_bytes INTEGER NOT NULL DEFAULT 0 CHECK(spool_bytes BETWEEN 0 AND quota_bytes),
    spool_rows INTEGER NOT NULL DEFAULT 0 CHECK(spool_rows BETWEEN 0 AND 65536),
    quota_bytes INTEGER NOT NULL DEFAULT 67108864 CHECK(quota_bytes BETWEEN 1024 AND 67108864),
    wrapper_high INTEGER NOT NULL DEFAULT 0, supervisor_high INTEGER NOT NULL DEFAULT 0,
    wrapper_expired INTEGER NOT NULL DEFAULT 0, supervisor_expired INTEGER NOT NULL DEFAULT 0
  );
  INSERT INTO accepted_attempts (id, attempt_id, organization_id, workspace_id, intent_digest,
    generation, state, last_seq, cancel_requested, offer_json, canonical_json)
    SELECT id, attempt_id, organization_id, workspace_id, intent_digest, generation, state,
      last_seq, cancel_requested, offer_json, canonical_json FROM accepted_attempts_v1;
  DROP TABLE accepted_attempts_v1;
  CREATE TABLE event_spool (
    attempt_id TEXT NOT NULL REFERENCES accepted_attempts(attempt_id),
    generation INTEGER NOT NULL CHECK(generation=1), seq INTEGER NOT NULL CHECK(seq>0),
    source TEXT NOT NULL CHECK(source IN ('wrapper','agent')),
    source_key INTEGER NOT NULL CHECK(source_key BETWEEN 1 AND 9007199254740991),
    canonical_json TEXT NOT NULL CHECK(length(CAST(canonical_json AS BLOB))<=65536),
    event_json TEXT NOT NULL CHECK(length(CAST(event_json AS BLOB))<=65536),
    encoded_bytes INTEGER NOT NULL CHECK(encoded_bytes BETWEEN 1 AND 65536),
    charged_bytes INTEGER NOT NULL CHECK(charged_bytes=encoded_bytes+length(CAST(canonical_json AS BLOB))+256),
    PRIMARY KEY(attempt_id,generation,seq), UNIQUE(attempt_id,generation,source,source_key)
  );
  PRAGMA user_version=2;
`;
const migration001 = `CREATE TABLE accepted_attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT, attempt_id TEXT NOT NULL UNIQUE,
  organization_id TEXT NOT NULL, workspace_id TEXT NOT NULL, intent_digest TEXT NOT NULL,
  generation INTEGER NOT NULL CHECK(generation=1), state TEXT NOT NULL CHECK(state='offered'),
  last_seq INTEGER NOT NULL CHECK(last_seq=0),
  cancel_requested INTEGER NOT NULL DEFAULT 0 CHECK(cancel_requested IN (0,1)),
  offer_json TEXT NOT NULL CHECK(length(CAST(offer_json AS BLOB))<=1048576),
  canonical_json TEXT NOT NULL CHECK(length(CAST(canonical_json AS BLOB))<=1048576)
); PRAGMA user_version=1;`;

export function initialize(path: string): DatabaseSync {
  const db = new DatabaseSync(path, { timeout: 100, enableForeignKeyConstraints: true });
  try {
    db.exec('PRAGMA busy_timeout=100; PRAGMA cache_size=-2048; PRAGMA locking_mode=EXCLUSIVE; BEGIN EXCLUSIVE; COMMIT;');
    const version = db.prepare('PRAGMA user_version').get()?.user_version;
    if (typeof version !== 'number' || version > 3) throw new Failure('schema_newer');
    db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON;');
    if (version < 3) transaction(db, () => {
      if (version === 0) db.exec(migration001);
      if (version < 2) db.exec(migration002);
      db.exec(migration003);
      if (db.prepare('PRAGMA foreign_key_check').get()) throw new Failure('unavailable');
    });
    return db;
  } catch (error) { db.close(); throw error; }
}

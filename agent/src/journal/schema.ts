import { migration024 } from './migration024.js';
import { registerNoTaskReceipt } from './no-task-receipts/store.js';
import { migration023 } from './migration023.js';
import { registerRejectedFunding } from './rejected-controls/guard.js';
import { migration022 } from './migration022.js';
import { registerSettlementGuard } from './settlement-guard/index.js';
import {migration021} from './migration021.js';
import {registerRuntimeAssociationValidation} from './runtime-associations/index.js';
import { migration020 } from './migration020.js';
import { registerCleanupReceiptValidation } from './cleanup-receipts/validation.js';
import { migration019 } from './migration019.js';
import { registerCleanupProgressValidation } from './cleanup-progress/validation.js';
import { migration018 } from './migration018.js';
import { registerCleanupPlanValidation } from './cleanup-plans/index.js';
import { migration017 } from './migration017.js';
import { registerRetirementValidation } from './retirement/index.js';
import { migration016 } from './migration016.js';
import { registerNamespaceValidation } from './staging-namespace/index.js';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { Failure, transaction } from './sql.js';
import { migration003 } from './migration003.js';
import { migration004 } from './supervision.js';
import { migration006 } from './migration006.js';
import { migration005 } from './migration005.js';
import { migration007 } from './migration007.js';
import { migration008 } from './migration008.js';
import { migration009 } from './migration009.js';
import { migration010 } from './migration010.js';
import { migration011 } from './migration011.js';
import { migration012 } from './migration012.js';
import { migration013 } from './migration013.js';
import { migration014 } from './migration014.js';
import { migration015 } from './migration015.js';

export const JOURNAL_SCHEMA_VERSION=24;

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

function migrateOwnership(db: DatabaseSync, version: number, authority: string | null): void {
  if (version < 9) {
    db.exec(migration009);
    db.prepare('INSERT INTO journal_authority(id,authority) VALUES (1,?)').run(authority);
  }
  if (version < 10) db.exec(migration010);
  if (version < 11) migration011(db);
  if (version < 12) migration012(db);
  if (version < 13) migration013(db);
  if (version < 14) migration014(db);
  migration015(db);
}
export function initialize(path: string): DatabaseSync {
  const db = new DatabaseSync(path, { timeout: 100, enableForeignKeyConstraints: true });
  try {
    db.exec('PRAGMA busy_timeout=100; PRAGMA cache_size=-2048; PRAGMA locking_mode=EXCLUSIVE; BEGIN EXCLUSIVE; COMMIT;');
    const version = db.prepare('PRAGMA user_version').get()?.user_version;
    if (typeof version !== 'number' || version > JOURNAL_SCHEMA_VERSION) throw new Failure('schema_newer');
    db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON;');
    const authority = version === 0 ? randomUUID() : null;
    registerNoTaskReceipt(db);registerRejectedFunding(db);registerSettlementGuard(db);registerRuntimeAssociationValidation(db); registerNamespaceValidation(db); registerRetirementValidation(db); registerCleanupPlanValidation(db); registerCleanupProgressValidation(db); registerCleanupReceiptValidation(db);
    if (version < JOURNAL_SCHEMA_VERSION) transaction(db, () => {
      migrateFoundation(db, version);
      if (version < 15) migrateOwnership(db, version, authority);
      migrateCleanup(db,version);
      if (db.prepare('PRAGMA foreign_key_check').get()) throw new Failure('unavailable');
    });
    // Samples and process-owned guard readiness are not valid startup authority.
    // Preserve configurations, clocks, queue and charged ownership; require refresh.
    db.prepare('UPDATE admission_settings SET observation_json=NULL WHERE id=1').run();
    return db;
  } catch (error) { db.close(); throw error; }
}

function migrateFoundation(db: DatabaseSync, version: number): void {
      if (version === 0) db.exec(migration001);
      if (version < 2) db.exec(migration002);
      if (version < 3) db.exec(migration003);
      if (version < 4) db.exec(migration004);
      if (version < 5) db.exec(migration005);
      if (version < 6) db.exec(migration006);
      if (version < 7) db.exec(migration007);
      if (version < 8) db.exec(migration008);
}

function migrateCleanup(db:DatabaseSync,version:number):void{
      if (version < 16) db.exec(migration016);
      if (version < 17) db.exec(migration017);
      if (version < 18) db.exec(migration018);
      if (version < 19) db.exec(migration019);
      if(version<20)db.exec(migration020);
      if(version<21)db.exec(migration021);
      if(version<22)db.exec(migration022);
      if(version<23)db.exec(migration023);
      db.exec(migration024);
}

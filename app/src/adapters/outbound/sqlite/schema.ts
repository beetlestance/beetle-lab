import { migration026 } from './migration026.js';
import { migrate025 } from './migration025.js';
import { registerRetentionAccounting } from './retention-accounting-guard/index.js';
import { migration024 } from './migration024.js';
import { registerBackendSettlement } from './backend-settlement-guard/index.js';
import { transaction } from './transaction.js';
import { migration023 } from './migration023.js';
import { registerCleanupAckValidation } from './cleanup-ack-guard/index.js';
import { migration022 } from './migration022.js';
import { migration021 } from './migration021.js';
import { migrate020 } from './migration020.js';
import { registerSearchFold } from './run-search-fold.js';
import { migration019 } from './migration019.js';
import { migration018 } from './migration018.js';
import { registerHistoryValidation } from './run-history/values.js';
import { migration017 } from './migration017.js';
import {migration016} from './migration016.js';
import { migration015 } from './migration015.js';
import { migration014 } from './migration014.js';
import { migration013 } from './migration013.js';
import { migration012 } from './migration012.js';
import { registerAbsenceValidation } from './output-absence/values.js';
import { migration011 } from './migration011.js';
import { migration010 } from './migration010.js';
import { migration009 } from './migration009.js';
import { migrate008 } from './migration008.js';
import { migration006 } from './migration006.js';
import { migration007 } from './migration007.js';
import { migration005 } from './migration005.js';
import { migration004 } from './migration004.js';
import { migrate003 } from './migration003.js';
import { migration002 } from './migration002.js';
import { DatabaseSync } from 'node:sqlite';
import { StorageError } from './protocol.js';

export const METADATA_SCHEMA_VERSION = 26;

// Application migration 001; independent of the agent journal schema.
export const migration001 = `
CREATE TABLE organizations (
 id TEXT PRIMARY KEY CHECK(id=lower(id)), version INTEGER NOT NULL CHECK(version>=1),
 name TEXT NOT NULL, slug TEXT NOT NULL UNIQUE);
CREATE TABLE workspaces (
 id TEXT PRIMARY KEY CHECK(id=lower(id)), organization_id TEXT NOT NULL,
 version INTEGER NOT NULL CHECK(version>=1), name TEXT NOT NULL, folded_name TEXT NOT NULL,
 root_folder_id TEXT NOT NULL UNIQUE, UNIQUE(id,organization_id), UNIQUE(organization_id,folded_name),
 FOREIGN KEY(organization_id) REFERENCES organizations(id),
 FOREIGN KEY(root_folder_id,organization_id,id) REFERENCES folders(id,organization_id,workspace_id)
 DEFERRABLE INITIALLY DEFERRED);
CREATE TABLE folders (
 id TEXT PRIMARY KEY CHECK(id=lower(id)), organization_id TEXT NOT NULL, workspace_id TEXT NOT NULL,
 parent_id TEXT, version INTEGER NOT NULL CHECK(version>=1), name TEXT NOT NULL, folded_name TEXT NOT NULL,
 UNIQUE(id,organization_id,workspace_id), UNIQUE(organization_id,workspace_id,parent_id,folded_name),
 FOREIGN KEY(workspace_id,organization_id) REFERENCES workspaces(id,organization_id),
 FOREIGN KEY(parent_id,organization_id,workspace_id) REFERENCES folders(id,organization_id,workspace_id));
CREATE UNIQUE INDEX folders_one_root ON folders(organization_id,workspace_id) WHERE parent_id IS NULL;
CREATE INDEX folders_children ON folders(organization_id,workspace_id,parent_id,id);
CREATE INDEX folders_page ON folders(organization_id,workspace_id,id);
CREATE INDEX workspaces_page ON workspaces(organization_id,id);
CREATE TRIGGER workspaces_root_immutable BEFORE UPDATE OF root_folder_id ON workspaces
WHEN NEW.root_folder_id IS NOT OLD.root_folder_id BEGIN
 SELECT RAISE(ABORT,'root identity immutable'); END;
CREATE TRIGGER folders_root_insert BEFORE INSERT ON folders BEGIN
 SELECT CASE WHEN ((NEW.parent_id IS NULL) !=
 (NEW.id=(SELECT root_folder_id FROM workspaces WHERE id=NEW.workspace_id AND organization_id=NEW.organization_id)))
 THEN RAISE(ABORT,'root invariant') END; END;
CREATE TRIGGER folders_root_update BEFORE UPDATE ON folders BEGIN
 SELECT CASE WHEN ((NEW.parent_id IS NULL) !=
 (NEW.id=(SELECT root_folder_id FROM workspaces WHERE id=NEW.workspace_id AND organization_id=NEW.organization_id)))
 THEN RAISE(ABORT,'root invariant') END; END;
CREATE TABLE settings (
 scope_key TEXT PRIMARY KEY, id TEXT NOT NULL UNIQUE CHECK(id=lower(id)), kind TEXT NOT NULL,
 organization_id TEXT, workspace_id TEXT, version INTEGER NOT NULL CHECK(version>=1),
 value_json TEXT NOT NULL CHECK(length(CAST(value_json AS BLOB))<=32768),
 CHECK((kind='installation' AND organization_id IS NULL AND workspace_id IS NULL AND scope_key='installation') OR
 (kind='organization' AND organization_id IS NOT NULL AND workspace_id IS NULL AND scope_key='organization:'||organization_id) OR
 (kind='workspace' AND organization_id IS NOT NULL AND workspace_id IS NOT NULL AND scope_key='workspace:'||organization_id||':'||workspace_id)),
 FOREIGN KEY(organization_id) REFERENCES organizations(id),
 FOREIGN KEY(workspace_id,organization_id) REFERENCES workspaces(id,organization_id));
CREATE TABLE receipts (
 scope_key TEXT NOT NULL, request_id TEXT NOT NULL CHECK(request_id=lower(request_id)),
 digest TEXT NOT NULL, result_json TEXT NOT NULL CHECK(length(CAST(result_json AS BLOB))<=65536),
 PRIMARY KEY(scope_key,request_id));
PRAGMA user_version=1;
`;

export { transaction } from './transaction.js';

export function initialize(path: string): DatabaseSync {
  const db = new DatabaseSync(path, { timeout: 100, enableForeignKeyConstraints: true, defensive: true });
  try {
    db.exec('PRAGMA busy_timeout=100; PRAGMA cache_size=-2048; PRAGMA locking_mode=EXCLUSIVE; BEGIN EXCLUSIVE; COMMIT;');
    const version = db.prepare('PRAGMA user_version').get()?.user_version;
    if (typeof version !== 'number' || version > METADATA_SCHEMA_VERSION) throw new StorageError('schema_newer');
    db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON; PRAGMA temp_store=MEMORY;');
    registerBackendSettlement(db);
    registerRetentionAccounting(db);
    registerCleanupAckValidation(db);
    registerAbsenceValidation(db);
    registerHistoryValidation(db);
    registerSearchFold(db);
    applyMigrations(db, version);
    return db;
  } catch (error) { db.close(); throw error; }
}

/** Each schema step retains its own atomic boundary and original version ordering. */
function applyMigrations(db: DatabaseSync, version: number): void {
  const steps: readonly (() => void)[] = [
    () => db.exec(migration001), () => db.exec(migration002), () => migrate003(db),
    () => db.exec(migration004), () => db.exec(migration005), () => db.exec(migration006),
    () => db.exec(migration007), () => migrate008(db), () => db.exec(migration009), () => db.exec(migration010), () => db.exec(migration011), () => db.exec(migration012), () => db.exec(migration013), () => db.exec(migration014), () => db.exec(migration015), () => db.exec(migration016), () => db.exec(migration017), () => db.exec(migration018), () => db.exec(migration019), () => migrate020(db), () => db.exec(migration021), () => db.exec(migration022), () => db.exec(migration023), () => db.exec(migration024), () => migrate025(db), () => db.exec(migration026),
  ];
  steps.forEach((step, index) => { if (version <= index) transaction(db, step); });
}

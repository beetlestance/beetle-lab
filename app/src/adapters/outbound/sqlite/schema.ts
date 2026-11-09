import { migration004 } from './migration004.js';
import { migrate003 } from './migration003.js';
import { migration002 } from './migration002.js';
import { DatabaseSync } from 'node:sqlite';
import { StorageError } from './protocol.js';

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

export function transaction<T>(db: DatabaseSync, work: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try { const result = work(); db.exec('COMMIT'); return result; }
  catch (error) {
    try { db.exec('ROLLBACK'); } catch { throw new StorageError('unavailable'); }
    throw error;
  }
}

export function initialize(path: string): DatabaseSync {
  const db = new DatabaseSync(path, { timeout: 100, enableForeignKeyConstraints: true });
  try {
    db.exec('PRAGMA busy_timeout=100; PRAGMA cache_size=-2048; PRAGMA locking_mode=EXCLUSIVE; BEGIN EXCLUSIVE; COMMIT;');
    const version = db.prepare('PRAGMA user_version').get()?.user_version;
    if (typeof version !== 'number' || version > 4) throw new StorageError('schema_newer');
    db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON; PRAGMA temp_store=MEMORY;');
    if (version === 0) transaction(db, () => db.exec(migration001));
    if (version < 2) transaction(db, () => db.exec(migration002));
    if (version < 3) transaction(db, () => migrate003(db));
    if (version < 4) transaction(db, () => db.exec(migration004));
    return db;
  } catch (error) { db.close(); throw error; }
}

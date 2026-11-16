import type { DatabaseSync } from 'node:sqlite';
import { StorageError } from './protocol.js';
import { inputLifecycleGuards } from './input-guards.js';

/** Application migration003: metadata custody intents, never evidence of bytes. */
const tables = `
ALTER TABLE input_blobs RENAME TO input_blobs_v2;
CREATE TABLE installation_storage_usage (
 id INTEGER PRIMARY KEY CHECK(id=1),
 charged_bytes INTEGER NOT NULL CHECK(typeof(charged_bytes)='integer' AND charged_bytes BETWEEN 0 AND 9007199254740991));
INSERT INTO installation_storage_usage VALUES(1,0);
CREATE TABLE input_blobs (
 id TEXT NOT NULL CHECK(id=lower(id)), organization_id TEXT NOT NULL CHECK(organization_id=lower(organization_id)),
 workspace_id TEXT NOT NULL CHECK(workspace_id=lower(workspace_id)), folder_id TEXT NOT NULL,
 name TEXT NOT NULL CHECK(length(CAST(name AS BLOB)) BETWEEN 1 AND 1024),
 sha256 TEXT NOT NULL CHECK(length(sha256)=64 AND sha256 NOT GLOB '*[^0-9a-f]*'),
 bytes INTEGER NOT NULL CHECK(typeof(bytes)='integer' AND bytes BETWEEN 0 AND 8388608),
 offset INTEGER NOT NULL CHECK(typeof(offset)='integer' AND offset BETWEEN 0 AND bytes),
 version INTEGER NOT NULL CHECK(typeof(version)='integer' AND version BETWEEN 1 AND 9007199254740991),
 state TEXT NOT NULL CHECK(state IN ('staging','publishing','published','deleting','deleted','failed')),
 reason TEXT CHECK(reason IN ('custody_missing','integrity','io','unverified_legacy')),
 create_request_id TEXT CHECK(create_request_id=lower(create_request_id)),
 seal_request_id TEXT CHECK(seal_request_id=lower(seal_request_id)),
 delete_request_id TEXT CHECK(delete_request_id=lower(delete_request_id)),
 PRIMARY KEY(organization_id,workspace_id,id), UNIQUE(organization_id,workspace_id,id,sha256,bytes),
 CHECK(state NOT IN ('publishing','published') OR offset=bytes),
 CHECK((state IN ('failed','deleting') OR reason IS NULL) AND (state!='failed' OR reason IS NOT NULL)),
 CHECK(state NOT IN ('deleting','deleted') OR delete_request_id IS NOT NULL),
 FOREIGN KEY(workspace_id,organization_id) REFERENCES workspaces(id,organization_id),
 FOREIGN KEY(folder_id,organization_id,workspace_id) REFERENCES folders(id,organization_id,workspace_id));
INSERT INTO input_blobs
 SELECT b.id,b.organization_id,b.workspace_id,w.root_folder_id,'input-'||b.id,b.sha256,b.bytes,
 CASE WHEN b.state='published' THEN b.bytes ELSE 0 END,1,
 CASE WHEN b.state='published' THEN 'publishing' ELSE 'failed' END,
 CASE WHEN b.state='published' THEN NULL ELSE 'unverified_legacy' END,NULL,NULL,NULL
 FROM input_blobs_v2 b LEFT JOIN workspaces w ON w.id=b.workspace_id AND w.organization_id=b.organization_id;
UPDATE installation_storage_usage SET charged_bytes=(SELECT coalesce(sum(bytes+65536),0) FROM input_blobs);
DROP TABLE input_blobs_v2;
CREATE INDEX inputs_recovery ON input_blobs(state,organization_id,workspace_id,id);
CREATE INDEX inputs_folder ON input_blobs(organization_id,workspace_id,folder_id,id);
CREATE UNIQUE INDEX revision_scoped_identity ON suite_revisions(id,organization_id,workspace_id);
CREATE TABLE revision_input_pins (
 revision_id TEXT NOT NULL, organization_id TEXT NOT NULL, workspace_id TEXT NOT NULL,
 input_id TEXT NOT NULL, sha256 TEXT NOT NULL, bytes INTEGER NOT NULL,
 PRIMARY KEY(revision_id,input_id),
 FOREIGN KEY(revision_id,organization_id,workspace_id) REFERENCES suite_revisions(id,organization_id,workspace_id),
 FOREIGN KEY(organization_id,workspace_id,input_id,sha256,bytes)
 REFERENCES input_blobs(organization_id,workspace_id,id,sha256,bytes));
CREATE INDEX input_pins_lookup ON revision_input_pins(organization_id,workspace_id,input_id);
`;
interface Revision { id: string; organization_id: string; workspace_id: string; input_manifest_json: string }
interface Pin { id: string; sha256: string; bytes: number }
function backfillPin(db: DatabaseSync, row: Revision, value: Pin, insert: ReturnType<DatabaseSync['prepare']>): void {
  if (!value || typeof value.id !== 'string' || typeof value.sha256 !== 'string' || !Number.isSafeInteger(value.bytes)) {
    throw new StorageError('unavailable');
  }
  const input = db.prepare(`SELECT state FROM input_blobs WHERE organization_id=? AND workspace_id=?
    AND id=? AND sha256=? AND bytes=?`).get(row.organization_id, row.workspace_id, value.id, value.sha256, value.bytes);
  if (input?.state !== 'publishing') throw new StorageError('unavailable');
  insert.run(row.id, row.organization_id, row.workspace_id, value.id, value.sha256, value.bytes);
}
function backfill(db: DatabaseSync): void {
  let after = '';
  const insert = db.prepare('INSERT INTO revision_input_pins VALUES(?,?,?,?,?,?)');
  for (;;) {
    const rows = db.prepare(`SELECT id,organization_id,workspace_id,input_manifest_json FROM suite_revisions
      WHERE id>? ORDER BY id LIMIT 100`).all(after) as unknown as Revision[];
    for (const row of rows) {
      const manifest: unknown = JSON.parse(row.input_manifest_json);
      if (!Array.isArray(manifest) || manifest.length > 1024) throw new StorageError('unavailable');
      for (const value of manifest as Pin[]) backfillPin(db, row, value, insert);
    }
    if (rows.length < 100) return;
    after = rows.at(-1)!.id;
  }
}
export function migrate003(db: DatabaseSync): void {
  db.exec(tables);
  backfill(db);
  db.exec(inputLifecycleGuards);
  db.exec('PRAGMA user_version=3');
}

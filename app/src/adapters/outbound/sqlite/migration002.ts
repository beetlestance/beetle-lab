/** Reserved application migration002: scoped authoring history, no input publisher. */
export const migration002 = `
CREATE TABLE suites (
 id TEXT PRIMARY KEY CHECK(id=lower(id)), organization_id TEXT NOT NULL, workspace_id TEXT NOT NULL,
 folder_id TEXT NOT NULL, name TEXT NOT NULL, folded_name TEXT NOT NULL,
 version INTEGER NOT NULL CHECK(version>=1), current_revision_id TEXT,
 UNIQUE(id,organization_id,workspace_id), UNIQUE(organization_id,workspace_id,folder_id,folded_name),
 FOREIGN KEY(workspace_id,organization_id) REFERENCES workspaces(id,organization_id),
 FOREIGN KEY(folder_id,organization_id,workspace_id) REFERENCES folders(id,organization_id,workspace_id),
 FOREIGN KEY(current_revision_id,id,organization_id,workspace_id)
 REFERENCES suite_revisions(id,suite_id,organization_id,workspace_id) DEFERRABLE INITIALLY DEFERRED);
CREATE TABLE suite_revisions (
 id TEXT PRIMARY KEY CHECK(id=lower(id)), suite_id TEXT NOT NULL,
 organization_id TEXT NOT NULL, workspace_id TEXT NOT NULL,
 ordinal INTEGER NOT NULL CHECK(ordinal>=1), digest TEXT NOT NULL,
 config_json TEXT NOT NULL CHECK(length(CAST(config_json AS BLOB))<=1048576),
 input_manifest_json TEXT NOT NULL CHECK(length(CAST(input_manifest_json AS BLOB))<=65536),
 UNIQUE(suite_id,ordinal), UNIQUE(id,suite_id,organization_id,workspace_id),
 FOREIGN KEY(suite_id,organization_id,workspace_id) REFERENCES suites(id,organization_id,workspace_id));
CREATE TRIGGER revisions_no_update BEFORE UPDATE ON suite_revisions BEGIN
 SELECT RAISE(ABORT,'immutable revision'); END;
CREATE TRIGGER revisions_no_delete BEFORE DELETE ON suite_revisions BEGIN
 SELECT RAISE(ABORT,'immutable revision'); END;
CREATE TRIGGER revisions_no_replace BEFORE INSERT ON suite_revisions
WHEN EXISTS(SELECT 1 FROM suite_revisions WHERE id=NEW.id OR (suite_id=NEW.suite_id AND ordinal=NEW.ordinal)) BEGIN
 SELECT RAISE(ABORT,'immutable revision'); END;
CREATE INDEX suites_page ON suites(organization_id,workspace_id,id);
CREATE INDEX revisions_page ON suite_revisions(organization_id,workspace_id,suite_id,id);
CREATE TABLE input_blobs (
 id TEXT NOT NULL CHECK(id=lower(id)), organization_id TEXT NOT NULL, workspace_id TEXT NOT NULL,
 sha256 TEXT NOT NULL CHECK(length(sha256)=64), bytes INTEGER NOT NULL CHECK(bytes>=0 AND bytes<=8388608),
 state TEXT NOT NULL CHECK(state IN ('staging','published')),
 PRIMARY KEY(organization_id,workspace_id,id),
 FOREIGN KEY(workspace_id,organization_id) REFERENCES workspaces(id,organization_id));
ALTER TABLE receipts RENAME TO receipts_v1;
CREATE TABLE receipts (
 scope_key TEXT NOT NULL, request_id TEXT NOT NULL CHECK(request_id=lower(request_id)),
 digest TEXT NOT NULL, result_json TEXT NOT NULL CHECK(length(CAST(result_json AS BLOB))<=2097152),
 PRIMARY KEY(scope_key,request_id));
INSERT INTO receipts SELECT * FROM receipts_v1;
DROP TABLE receipts_v1;
PRAGMA user_version=2;
`;

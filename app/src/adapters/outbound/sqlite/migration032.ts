/**
 * Input metadata and usage. Existing rows keep NULL creation/publication times and
 * no shape: nothing is inferred from custody state. Times are written once by the
 * metadata worker; shapes are written once after verified publication; usage counts
 * equal the immutable revision pins and are maintained only by the pin trigger.
 * Number 031 is reserved for the authoring-metadata lane.
 */
const sameInput = (alias: string) =>
  `organization_id=${alias}.organization_id AND workspace_id=${alias}.workspace_id AND input_id=${alias}.input_id`;
const pinCount = `(SELECT count(*) FROM revision_input_pins WHERE ${sameInput('NEW')})`;
export const migration032 = `
ALTER TABLE input_blobs ADD COLUMN created_at TEXT
 CHECK(created_at IS NULL OR (typeof(created_at)='text' AND length(created_at) BETWEEN 20 AND 40));
ALTER TABLE input_blobs ADD COLUMN published_at TEXT
 CHECK(published_at IS NULL OR (typeof(published_at)='text' AND length(published_at) BETWEEN 20 AND 40));
CREATE TRIGGER inputs_times_insert BEFORE INSERT ON input_blobs
 WHEN NEW.created_at IS NULL OR NEW.published_at IS NOT NULL
 BEGIN SELECT RAISE(ABORT,'input times'); END;
CREATE TRIGGER inputs_times_update BEFORE UPDATE ON input_blobs WHEN NEW.created_at IS NOT OLD.created_at
 OR (NEW.published_at IS NOT OLD.published_at AND NOT (OLD.published_at IS NULL AND OLD.state='publishing' AND NEW.state='published'))
 OR (OLD.state='publishing' AND NEW.state='published' AND NEW.published_at IS NULL)
 BEGIN SELECT RAISE(ABORT,'input times'); END;
CREATE TABLE input_shapes (
 organization_id TEXT NOT NULL, workspace_id TEXT NOT NULL, input_id TEXT NOT NULL,
 sha256 TEXT NOT NULL, bytes INTEGER NOT NULL,
 row_count INTEGER CHECK(row_count IS NULL OR (typeof(row_count)='integer' AND row_count BETWEEN 0 AND 1048576)),
 column_count INTEGER CHECK(column_count IS NULL OR (typeof(column_count)='integer' AND column_count BETWEEN 1 AND 1024)),
 CHECK(row_count IS NOT NULL OR column_count IS NOT NULL),
 PRIMARY KEY(organization_id,workspace_id,input_id),
 FOREIGN KEY(organization_id,workspace_id,input_id,sha256,bytes)
 REFERENCES input_blobs(organization_id,workspace_id,id,sha256,bytes)) WITHOUT ROWID;
CREATE TRIGGER input_shapes_insert BEFORE INSERT ON input_shapes WHEN NOT EXISTS(SELECT 1 FROM input_blobs
 WHERE organization_id=NEW.organization_id AND workspace_id=NEW.workspace_id AND id=NEW.input_id
 AND sha256=NEW.sha256 AND bytes=NEW.bytes AND state='published')
 OR EXISTS(SELECT 1 FROM input_shapes WHERE ${sameInput('NEW')})
 BEGIN SELECT RAISE(ABORT,'input shape'); END;
CREATE TRIGGER input_shapes_no_update BEFORE UPDATE ON input_shapes BEGIN SELECT RAISE(ABORT,'immutable input shape'); END;
CREATE TRIGGER input_shapes_no_delete BEFORE DELETE ON input_shapes BEGIN SELECT RAISE(ABORT,'immutable input shape'); END;
-- Supersedes the 003 prefix index: same lookups, plus revision order for usage pages.
CREATE INDEX input_pins_usage ON revision_input_pins(organization_id,workspace_id,input_id,revision_id);
DROP INDEX input_pins_lookup;
CREATE TABLE input_usage_counts (
 organization_id TEXT NOT NULL, workspace_id TEXT NOT NULL, input_id TEXT NOT NULL,
 revisions INTEGER NOT NULL CHECK(typeof(revisions)='integer' AND revisions BETWEEN 1 AND 9007199254740991),
 PRIMARY KEY(organization_id,workspace_id,input_id),
 FOREIGN KEY(organization_id,workspace_id,input_id) REFERENCES input_blobs(organization_id,workspace_id,id)) WITHOUT ROWID;
INSERT INTO input_usage_counts SELECT organization_id,workspace_id,input_id,count(*) FROM revision_input_pins
 GROUP BY organization_id,workspace_id,input_id;
CREATE TRIGGER input_usage_counts_insert BEFORE INSERT ON input_usage_counts WHEN NEW.revisions IS NOT ${pinCount}
 BEGIN SELECT RAISE(ABORT,'input usage count'); END;
CREATE TRIGGER input_usage_counts_update BEFORE UPDATE ON input_usage_counts
 WHEN NEW.organization_id IS NOT OLD.organization_id OR NEW.workspace_id IS NOT OLD.workspace_id
 OR NEW.input_id IS NOT OLD.input_id OR NEW.revisions IS NOT ${pinCount}
 BEGIN SELECT RAISE(ABORT,'input usage count'); END;
CREATE TRIGGER input_usage_counts_no_delete BEFORE DELETE ON input_usage_counts
 BEGIN SELECT RAISE(ABORT,'input usage count'); END;
CREATE TRIGGER input_usage_count AFTER INSERT ON revision_input_pins BEGIN
 UPDATE input_usage_counts SET revisions=revisions+1 WHERE ${sameInput('NEW')};
 INSERT INTO input_usage_counts SELECT NEW.organization_id,NEW.workspace_id,NEW.input_id,1
 WHERE NOT EXISTS(SELECT 1 FROM input_usage_counts WHERE ${sameInput('NEW')});
END;
PRAGMA user_version=32;
`;

/** SQL defenses also reject REPLACE with recursive_triggers disabled. */
export const inputLifecycleGuards = `
CREATE TRIGGER inputs_no_replace BEFORE INSERT ON input_blobs
WHEN EXISTS(SELECT 1 FROM input_blobs WHERE organization_id=NEW.organization_id AND workspace_id=NEW.workspace_id AND id=NEW.id)
BEGIN SELECT RAISE(ABORT,'immutable input'); END;
CREATE TRIGGER inputs_insert BEFORE INSERT ON input_blobs BEGIN
 SELECT CASE WHEN NEW.state!='staging' OR NEW.offset!=0 OR NEW.version!=1 OR NEW.create_request_id IS NULL
 OR NEW.seal_request_id IS NOT NULL OR NEW.delete_request_id IS NOT NULL OR NEW.reason IS NOT NULL
 THEN RAISE(ABORT,'invalid initial input') END;
 SELECT CASE WHEN (SELECT charged_bytes FROM installation_storage_usage WHERE id=1)>9007199254740991-NEW.bytes-65536
 THEN RAISE(ABORT,'unsafe charge') END; END;
CREATE TRIGGER inputs_charge AFTER INSERT ON input_blobs BEGIN
 UPDATE installation_storage_usage SET charged_bytes=charged_bytes+NEW.bytes+65536 WHERE id=1; END;
CREATE TRIGGER inputs_no_delete BEFORE DELETE ON input_blobs BEGIN SELECT RAISE(ABORT,'retained input'); END;
CREATE TRIGGER inputs_identity BEFORE UPDATE ON input_blobs BEGIN
 SELECT CASE WHEN NEW.id IS NOT OLD.id OR NEW.organization_id IS NOT OLD.organization_id
 OR NEW.workspace_id IS NOT OLD.workspace_id OR NEW.folder_id IS NOT OLD.folder_id OR NEW.name IS NOT OLD.name
 OR NEW.sha256 IS NOT OLD.sha256 OR NEW.bytes IS NOT OLD.bytes OR NEW.create_request_id IS NOT OLD.create_request_id
 OR (OLD.seal_request_id IS NOT NULL AND NEW.seal_request_id IS NOT OLD.seal_request_id)
 OR (OLD.delete_request_id IS NOT NULL AND NEW.delete_request_id IS NOT OLD.delete_request_id)
 THEN RAISE(ABORT,'immutable input') END;
 SELECT CASE WHEN NEW.version!=OLD.version+1 THEN RAISE(ABORT,'input version') END;
 SELECT CASE WHEN NOT (
 (OLD.state='staging' AND NEW.state='staging' AND NEW.offset>OLD.offset AND NEW.seal_request_id IS OLD.seal_request_id AND NEW.delete_request_id IS OLD.delete_request_id) OR
 (OLD.state='staging' AND NEW.state='publishing' AND NEW.offset=OLD.offset AND NEW.offset=NEW.bytes AND OLD.seal_request_id IS NULL AND NEW.seal_request_id IS NOT NULL AND NEW.delete_request_id IS OLD.delete_request_id) OR
 (OLD.state='publishing' AND NEW.state='published' AND NEW.offset=OLD.offset AND NEW.seal_request_id IS OLD.seal_request_id AND NEW.delete_request_id IS OLD.delete_request_id) OR
 (OLD.state IN ('staging','publishing','published','failed') AND NEW.state='deleting' AND NEW.offset=OLD.offset AND OLD.delete_request_id IS NULL AND NEW.delete_request_id IS NOT NULL AND NEW.seal_request_id IS OLD.seal_request_id) OR
 (OLD.state='deleting' AND NEW.state IN ('deleting','deleted') AND NEW.offset=OLD.offset AND NEW.seal_request_id IS OLD.seal_request_id AND NEW.delete_request_id IS OLD.delete_request_id) OR
 (OLD.state IN ('staging','publishing','published') AND NEW.state='failed' AND NEW.offset=OLD.offset AND NEW.seal_request_id IS OLD.seal_request_id AND NEW.delete_request_id IS OLD.delete_request_id))
 THEN RAISE(ABORT,'input transition') END;
 SELECT CASE WHEN NEW.state='deleting' AND EXISTS(SELECT 1 FROM revision_input_pins
 WHERE organization_id=OLD.organization_id AND workspace_id=OLD.workspace_id AND input_id=OLD.id)
 THEN RAISE(ABORT,'retained pin') END; END;
CREATE TRIGGER inputs_release AFTER UPDATE ON input_blobs WHEN NEW.state='deleted' BEGIN
 UPDATE installation_storage_usage SET charged_bytes=charged_bytes-NEW.bytes WHERE id=1; END;
CREATE TRIGGER usage_no_delete BEFORE DELETE ON installation_storage_usage BEGIN SELECT RAISE(ABORT,'retained usage'); END;
CREATE TRIGGER usage_no_replace BEFORE INSERT ON installation_storage_usage WHEN EXISTS(SELECT 1 FROM installation_storage_usage)
BEGIN SELECT RAISE(ABORT,'retained usage'); END;
CREATE TRIGGER pins_insert BEFORE INSERT ON revision_input_pins BEGIN
 SELECT CASE WHEN EXISTS(SELECT 1 FROM revision_input_pins WHERE revision_id=NEW.revision_id AND input_id=NEW.input_id)
 THEN RAISE(ABORT,'immutable pin') END;
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM input_blobs WHERE organization_id=NEW.organization_id
 AND workspace_id=NEW.workspace_id AND id=NEW.input_id AND sha256=NEW.sha256 AND bytes=NEW.bytes AND state='published')
 THEN RAISE(ABORT,'unpublished pin') END; END;
CREATE TRIGGER pins_no_update BEFORE UPDATE ON revision_input_pins BEGIN SELECT RAISE(ABORT,'immutable pin'); END;
CREATE TRIGGER pins_no_delete BEFORE DELETE ON revision_input_pins BEGIN SELECT RAISE(ABORT,'retained pin'); END;
`;

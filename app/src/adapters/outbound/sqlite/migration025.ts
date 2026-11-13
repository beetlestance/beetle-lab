import type { DatabaseSync } from 'node:sqlite';
/** No epoch backfill or free reservation: first preview pays its actual permanent row. */
export const migration025=`
CREATE TABLE retention_workspace_epochs (
 workspace_id TEXT PRIMARY KEY,organization_id TEXT NOT NULL,
 epoch INTEGER NOT NULL CHECK(typeof(epoch)='integer' AND epoch BETWEEN 1 AND 9007199254740991),
 charged_bytes INTEGER NOT NULL CHECK(charged_bytes=512),
 FOREIGN KEY(workspace_id,organization_id) REFERENCES workspaces(id,organization_id));
CREATE TABLE retention_storage (
 id INTEGER PRIMARY KEY CHECK(id=1),epoch_count INTEGER NOT NULL CHECK(typeof(epoch_count)='integer' AND epoch_count BETWEEN 0 AND 17592186044415),
 snapshot_count INTEGER NOT NULL CHECK(typeof(snapshot_count)='integer' AND snapshot_count BETWEEN 0 AND 8),
 charged_bytes INTEGER NOT NULL CHECK(typeof(charged_bytes)='integer' AND charged_bytes BETWEEN 0 AND 9007199254740991),
 clock_ms INTEGER NOT NULL CHECK(typeof(clock_ms)='integer' AND clock_ms BETWEEN 0 AND 253402300799999),
 CHECK(charged_bytes=epoch_count*512+snapshot_count*131072));
INSERT INTO retention_storage VALUES(1,0,0,0,0);
CREATE TABLE retention_snapshots (
 id TEXT PRIMARY KEY CHECK(length(id)=36 AND id=lower(id)),organization_id TEXT NOT NULL,workspace_id TEXT NOT NULL,
 request_id TEXT NOT NULL CHECK(length(request_id)=36 AND request_id=lower(request_id)),
 intent_digest TEXT NOT NULL CHECK(length(intent_digest)=64 AND intent_digest NOT GLOB '*[^0-9a-f]*'),
 captured_at TEXT NOT NULL CHECK(length(captured_at)=24),expires_at TEXT NOT NULL CHECK(length(expires_at)=24),
 epoch INTEGER NOT NULL CHECK(typeof(epoch)='integer' AND epoch BETWEEN 1 AND 9007199254740991),
 body_json TEXT NOT NULL CHECK(typeof(body_json)='text' AND length(CAST(body_json AS BLOB))<=32768 AND json_valid(body_json)),
 state TEXT NOT NULL CHECK(state IN ('preview','applied')),apply_json TEXT CHECK(apply_json IS NULL OR (json_valid(apply_json) AND length(CAST(apply_json AS BLOB))<=2048)),
 charged_bytes INTEGER NOT NULL CHECK(charged_bytes=131072),UNIQUE(workspace_id,request_id),
 CHECK((state='preview' AND apply_json IS NULL) OR (state='applied' AND apply_json IS NOT NULL)),
 CHECK(id=json_extract(body_json,'$.id') AND request_id=json_extract(body_json,'$.requestId') AND intent_digest=json_extract(body_json,'$.intentDigest')),
 CHECK(organization_id=json_extract(body_json,'$.scope.organizationId') AND workspace_id=json_extract(body_json,'$.scope.workspaceId')),
 CHECK(epoch=json_extract(body_json,'$.epoch') AND captured_at=json_extract(body_json,'$.capturedAt') AND expires_at=json_extract(body_json,'$.expiresAt')),
 FOREIGN KEY(workspace_id,organization_id) REFERENCES workspaces(id,organization_id));
CREATE INDEX retention_expiry ON retention_snapshots(expires_at,id);
CREATE TABLE retention_progress (
 snapshot_id TEXT NOT NULL REFERENCES retention_snapshots(id),ordinal INTEGER NOT NULL CHECK(typeof(ordinal)='integer' AND ordinal BETWEEN 0 AND 99),
 run_id TEXT NOT NULL CHECK(length(run_id)=36),deletion_id TEXT NOT NULL CHECK(length(deletion_id)=36),request_id TEXT NOT NULL CHECK(length(request_id)=36),
 body_json TEXT NOT NULL CHECK(typeof(body_json)='text' AND json_valid(body_json) AND length(CAST(body_json AS BLOB))<=256),
 PRIMARY KEY(snapshot_id,ordinal),UNIQUE(snapshot_id,run_id),UNIQUE(snapshot_id,deletion_id));
CREATE TRIGGER retention_epoch_insert BEFORE INSERT ON retention_workspace_epochs WHEN backend_settlement_active()=1
 OR EXISTS(SELECT 1 FROM retention_workspace_epochs WHERE workspace_id=NEW.workspace_id)
 OR retention_insert_allowed('epoch',NEW.organization_id,NEW.workspace_id,NEW.workspace_id,NULL) IS NOT 1
 BEGIN SELECT RAISE(ABORT,'epoch requires paid reservation');END;
CREATE TRIGGER retention_epoch_delete BEFORE DELETE ON retention_workspace_epochs BEGIN SELECT RAISE(ABORT,'permanent retention epoch');END;
CREATE TRIGGER retention_epoch_update BEFORE UPDATE ON retention_workspace_epochs WHEN retention_metadata_active()=1
 OR NEW.workspace_id IS NOT OLD.workspace_id OR NEW.organization_id IS NOT OLD.organization_id OR NEW.charged_bytes IS NOT OLD.charged_bytes
 OR NEW.epoch IS NOT OLD.epoch+1 OR (backend_settlement_active()=1 AND backend_settlement_epoch(OLD.organization_id,OLD.workspace_id,OLD.epoch,NEW.epoch) IS NOT 1)
 BEGIN SELECT RAISE(ABORT,'invalid retention epoch change');END;
CREATE TRIGGER retention_snapshot_insert BEFORE INSERT ON retention_snapshots WHEN backend_settlement_active()=1 OR NEW.state!='preview'
 OR EXISTS(SELECT 1 FROM retention_snapshots WHERE id=NEW.id OR (workspace_id=NEW.workspace_id AND request_id=NEW.request_id))
 OR retention_insert_allowed('snapshot',NEW.organization_id,NEW.workspace_id,NEW.id,NEW.body_json) IS NOT 1
 BEGIN SELECT RAISE(ABORT,'snapshot requires paid reservation');END;
CREATE TRIGGER retention_snapshot_update BEFORE UPDATE ON retention_snapshots BEGIN SELECT RAISE(ABORT,'immutable retention snapshot');END;
CREATE TRIGGER retention_snapshot_delete BEFORE DELETE ON retention_snapshots WHEN backend_settlement_active()=1 OR
 retention_delete_allowed('snapshot',OLD.id,OLD.body_json,json_array(OLD.state,OLD.apply_json,OLD.charged_bytes)) IS NOT 1
 BEGIN SELECT RAISE(ABORT,'retained retention snapshot');END;
CREATE TRIGGER retention_storage_insert BEFORE INSERT ON retention_storage BEGIN SELECT RAISE(ABORT,'retained retention counter');END;
CREATE TRIGGER retention_storage_delete BEFORE DELETE ON retention_storage BEGIN SELECT RAISE(ABORT,'retained retention counter');END;
CREATE TRIGGER retention_storage_update BEFORE UPDATE ON retention_storage WHEN backend_settlement_active()=1 OR
 retention_counter_allowed('storage',json_array(OLD.id,OLD.epoch_count,OLD.snapshot_count,OLD.charged_bytes,OLD.clock_ms),json_array(NEW.id,NEW.epoch_count,NEW.snapshot_count,NEW.charged_bytes,NEW.clock_ms)) IS NOT 1
 BEGIN SELECT RAISE(ABORT,'invalid retention accounting');END;
CREATE TRIGGER retention_usage_update BEFORE UPDATE ON installation_storage_usage WHEN retention_metadata_active()=1 AND
 retention_counter_allowed('usage',json_array(OLD.id,OLD.charged_bytes),json_array(NEW.id,NEW.charged_bytes)) IS NOT 1
 BEGIN SELECT RAISE(ABORT,'different retention charge');END;
CREATE TRIGGER retention_run_insert AFTER INSERT ON runs BEGIN UPDATE retention_workspace_epochs SET epoch=epoch+1 WHERE workspace_id=NEW.workspace_id AND organization_id=NEW.organization_id;END;
CREATE TRIGGER retention_run_update AFTER UPDATE ON runs BEGIN UPDATE retention_workspace_epochs SET epoch=epoch+1 WHERE workspace_id=NEW.workspace_id AND organization_id=NEW.organization_id;END;
CREATE TRIGGER retention_run_delete AFTER DELETE ON runs BEGIN UPDATE retention_workspace_epochs SET epoch=epoch+1 WHERE workspace_id=OLD.workspace_id AND organization_id=OLD.organization_id;END;
CREATE TRIGGER retention_deletion_insert AFTER INSERT ON output_deletion_intents BEGIN UPDATE retention_workspace_epochs SET epoch=epoch+1 WHERE workspace_id=NEW.workspace_id AND organization_id=NEW.organization_id;END;
PRAGMA user_version=25;
`;
/** Freeze pre-existing owners during the fixed reservation frame; no callbacks/IO occur. */
export function migrate025(db:DatabaseSync):void{
 const tables=db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name LIMIT 129").all();
 if(tables.length>128)throw Error('Unexpected metadata owner count');
 db.exec(migration025);
 for(const row of tables){
  if(typeof row.name!=='string'||!/^[a-z_]+$/.test(row.name))throw Error('Unexpected metadata owner');const table=row.name;
  if(table==='installation_storage_usage')continue;
  for(const event of ['INSERT','UPDATE','DELETE'])db.exec(`CREATE TRIGGER retention_funding_${table}_${event.toLowerCase()} BEFORE ${event} ON ${table}
   WHEN retention_metadata_active()=1 BEGIN SELECT RAISE(ABORT,'outside retention reservation');END;`);
 }
 for(const event of ['INSERT','UPDATE','DELETE'])db.exec(`CREATE TRIGGER retention_progress_${event.toLowerCase()} BEFORE ${event} ON retention_progress
  BEGIN SELECT RAISE(ABORT,'retention progress owner pending');END;`);
}

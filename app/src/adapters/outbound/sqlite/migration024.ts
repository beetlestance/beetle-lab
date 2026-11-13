import { settlementGuards } from './backend-settlement/guards.js';
const safe=(name:string)=>`${name} INTEGER NOT NULL CHECK(typeof(${name})='integer' AND ${name} BETWEEN 0 AND 9007199254740991)`;
/** Permanent replay floors replace only positively settled original debt. No backfill. */
export const migration024=`
CREATE TABLE backend_retired_runs (
 run_id TEXT PRIMARY KEY CHECK(length(run_id)=36 AND run_id=lower(run_id)),
 attempt_id TEXT NOT NULL UNIQUE CHECK(length(attempt_id)=36 AND attempt_id=lower(attempt_id)),
 deletion_id TEXT NOT NULL UNIQUE CHECK(length(deletion_id)=36 AND deletion_id=lower(deletion_id)),
 organization_id TEXT NOT NULL,workspace_id TEXT NOT NULL,
 tombstone_json TEXT NOT NULL CHECK(typeof(tombstone_json)='text' AND length(CAST(tombstone_json AS BLOB))<=2048 AND json_valid(tombstone_json)),
 tombstone_digest TEXT NOT NULL CHECK(length(tombstone_digest)=64 AND tombstone_digest NOT GLOB '*[^0-9a-f]*'),
 charged_bytes INTEGER NOT NULL CHECK(charged_bytes=2560),
 FOREIGN KEY(workspace_id,organization_id) REFERENCES workspaces(id,organization_id));
CREATE TABLE backend_replay_storage (
 id INTEGER PRIMARY KEY CHECK(id=1),${safe('original_count')},${safe('charged_bytes')},CHECK(charged_bytes=original_count*2560));
INSERT INTO backend_replay_storage VALUES(1,0,0);
CREATE TRIGGER backend_retired_insert BEFORE INSERT ON backend_retired_runs BEGIN
 SELECT CASE WHEN EXISTS(SELECT 1 FROM backend_retired_runs WHERE run_id=NEW.run_id OR attempt_id=NEW.attempt_id OR deletion_id=NEW.deletion_id)
 OR backend_settlement_insert(NEW.run_id,NEW.attempt_id,NEW.deletion_id,NEW.tombstone_json,NEW.tombstone_digest) IS NOT 1
 OR NEW.organization_id IS NOT json_extract(NEW.tombstone_json,'$.organizationId')
 OR NEW.workspace_id IS NOT json_extract(NEW.tombstone_json,'$.workspaceId')
 THEN RAISE(ABORT,'settlement requires validated transaction') END;END;
CREATE TRIGGER backend_retired_update BEFORE UPDATE ON backend_retired_runs BEGIN SELECT RAISE(ABORT,'immutable retired original');END;
CREATE TRIGGER backend_retired_delete BEFORE DELETE ON backend_retired_runs BEGIN SELECT RAISE(ABORT,'permanent retired original');END;
CREATE TRIGGER backend_replay_insert BEFORE INSERT ON backend_replay_storage BEGIN SELECT RAISE(ABORT,'retained replay counter');END;
CREATE TRIGGER backend_replay_delete BEFORE DELETE ON backend_replay_storage BEGIN SELECT RAISE(ABORT,'retained replay counter');END;
CREATE TRIGGER backend_replay_update BEFORE UPDATE ON backend_replay_storage
 WHEN backend_settlement_counter('replay',json_array(OLD.id,OLD.original_count,OLD.charged_bytes),json_array(NEW.id,NEW.original_count,NEW.charged_bytes)) IS NOT 1
 BEGIN SELECT RAISE(ABORT,'replay counter requires settlement');END;
CREATE TRIGGER settlement_usage_update BEFORE UPDATE ON installation_storage_usage WHEN backend_settlement_active()=1
 AND backend_settlement_counter('usage',json_array(OLD.id,OLD.charged_bytes),json_array(NEW.id,NEW.charged_bytes)) IS NOT 1
 BEGIN SELECT RAISE(ABORT,'different settlement credit');END;
CREATE TRIGGER settlement_usage_insert BEFORE INSERT ON installation_storage_usage WHEN backend_settlement_active()=1
 BEGIN SELECT RAISE(ABORT,'retained settlement usage');END;
CREATE TRIGGER runs_retired_insert BEFORE INSERT ON runs WHEN EXISTS(SELECT 1 FROM backend_retired_runs WHERE run_id=NEW.id COLLATE NOCASE)
 BEGIN SELECT RAISE(ABORT,'retired run');END;
CREATE TRIGGER attempts_retired_insert BEFORE INSERT ON attempts WHEN EXISTS(SELECT 1 FROM backend_retired_runs WHERE attempt_id=NEW.id COLLATE NOCASE OR run_id=NEW.run_id COLLATE NOCASE)
 BEGIN SELECT RAISE(ABORT,'retired attempt');END;
CREATE TRIGGER deletion_retired_insert BEFORE INSERT ON output_deletion_intents WHEN EXISTS(SELECT 1 FROM backend_retired_runs WHERE deletion_id=NEW.id COLLATE NOCASE)
 BEGIN SELECT RAISE(ABORT,'retired deletion');END;
CREATE TRIGGER order_retired_insert BEFORE INSERT ON execution_orders WHEN EXISTS(SELECT 1 FROM backend_retired_runs WHERE attempt_id=NEW.attempt_id COLLATE NOCASE)
 BEGIN SELECT RAISE(ABORT,'retired execution order');END;
CREATE TRIGGER export_attempt_retired_insert BEFORE INSERT ON export_jobs WHEN EXISTS(SELECT 1 FROM backend_retired_runs WHERE attempt_id=NEW.attempt_id COLLATE NOCASE)
 BEGIN SELECT RAISE(ABORT,'retired performance original');END;
${settlementGuards}
PRAGMA user_version=24;
`;

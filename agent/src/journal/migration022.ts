import { retainedDeleteGuards,settlementIsolation,settlementGlobalIsolation } from './settlements/delete-guards.js';
/** No backfill/refund: pre-existing originals keep all charges until actual settlement. */
export const migration022=`
CREATE TABLE retired_attempts(
 attempt_id TEXT PRIMARY KEY COLLATE NOCASE,
 organization_id TEXT NOT NULL,workspace_id TEXT NOT NULL,
 settlement_request_digest TEXT NOT NULL CHECK(length(settlement_request_digest)=64),
 tombstone_digest TEXT NOT NULL UNIQUE CHECK(length(tombstone_digest)=64),
 tombstone_json TEXT NOT NULL CHECK(typeof(tombstone_json)='text' AND length(CAST(tombstone_json AS BLOB))<=3584),
 charged_bytes INTEGER NOT NULL CHECK(charged_bytes=4096),
 CHECK(attempt_id=json_extract(tombstone_json,'$.reply.attemptId')),
 CHECK(organization_id=json_extract(tombstone_json,'$.reply.organizationId')),
 CHECK(workspace_id=json_extract(tombstone_json,'$.reply.workspaceId')),
 CHECK(settlement_request_digest=json_extract(tombstone_json,'$.settlementRequestDigest'))
);
CREATE TABLE agent_replay_storage(
 id INTEGER PRIMARY KEY CHECK(id=1),
 original_count INTEGER NOT NULL CHECK(typeof(original_count)='integer' AND original_count BETWEEN 0 AND 2199023255551),
 charged_bytes INTEGER NOT NULL CHECK(typeof(charged_bytes)='integer' AND charged_bytes=original_count*4096)
);
INSERT INTO agent_replay_storage VALUES(1,0,0);
CREATE TRIGGER agent_replay_insert BEFORE INSERT ON retired_attempts
 WHEN agent_settlement_insert_allowed(NEW.attempt_id,NEW.tombstone_json,NEW.tombstone_digest)!=1
 BEGIN SELECT RAISE(ABORT,'unauthorized settlement tombstone'); END;
CREATE TRIGGER agent_replay_immutable BEFORE UPDATE ON retired_attempts
 BEGIN SELECT RAISE(ABORT,'immutable settlement tombstone'); END;
CREATE TRIGGER agent_replay_retained BEFORE DELETE ON retired_attempts
 BEGIN SELECT RAISE(ABORT,'retained settlement tombstone'); END;
CREATE TRIGGER agent_replay_charge AFTER INSERT ON retired_attempts BEGIN
 UPDATE agent_replay_storage SET original_count=original_count+1,charged_bytes=charged_bytes+4096 WHERE id=1;
 SELECT CASE WHEN changes()!=1 THEN RAISE(ABORT,'missing replay counter') END;
END;
CREATE TRIGGER agent_replay_stats_insert BEFORE INSERT ON agent_replay_storage BEGIN SELECT RAISE(ABORT,'immutable replay singleton'); END;
CREATE TRIGGER agent_replay_stats_delete BEFORE DELETE ON agent_replay_storage BEGIN SELECT RAISE(ABORT,'retained replay counter'); END;
CREATE TRIGGER agent_replay_stats_update BEFORE UPDATE ON agent_replay_storage
 WHEN agent_settlement_replay_stats_allowed(OLD.original_count,OLD.charged_bytes,NEW.original_count,NEW.charged_bytes)!=1
 BEGIN SELECT RAISE(ABORT,'unauthorized replay counter'); END;
CREATE TRIGGER agent_replay_accepted_insert BEFORE INSERT ON accepted_attempts
 WHEN EXISTS(SELECT 1 FROM retired_attempts WHERE attempt_id=NEW.attempt_id)
 BEGIN SELECT RAISE(ABORT,'retired original'); END;
CREATE TRIGGER settlement_parent_delete BEFORE DELETE ON accepted_attempts
 WHEN agent_settlement_delete_allowed(OLD.attempt_id,'accepted_attempts')!=1
 BEGIN SELECT RAISE(ABORT,'retained original'); END;
CREATE TRIGGER settlement_hold_stats BEFORE UPDATE ON disk_retention_stats WHEN agent_settlement_active()=1
 AND agent_settlement_hold_stats_allowed(
 json_array(OLD.held_count,OLD.held_output_bytes,OLD.held_staging_bytes,OLD.retained_output_bytes,OLD.retained_staging_bytes),
 json_array(NEW.held_count,NEW.held_output_bytes,NEW.held_staging_bytes,NEW.retained_output_bytes,NEW.retained_staging_bytes))!=1
 BEGIN SELECT RAISE(ABORT,'settlement hold counter isolation'); END;
CREATE TRIGGER settlement_hold_deleted AFTER DELETE ON disk_holds BEGIN
 UPDATE disk_retention_stats SET held_count=held_count-1,held_output_bytes=held_output_bytes-OLD.output_bytes,
 held_staging_bytes=held_staging_bytes-OLD.staging_bytes,
 retained_output_bytes=retained_output_bytes-OLD.output_bytes,retained_staging_bytes=retained_staging_bytes-OLD.staging_bytes WHERE id=1;
 SELECT CASE WHEN changes()!=1 THEN RAISE(ABORT,'missing hold counter') END;
END;
${retainedDeleteGuards}
${settlementIsolation}
${settlementGlobalIsolation}
PRAGMA user_version=22;
`;

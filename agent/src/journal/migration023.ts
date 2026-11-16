import { retirementTables } from './retirement/schema.js';
// Preserve the historical migration literal; only the new migration replaces its trigger.
const start=retirementTables.indexOf('CREATE TRIGGER retirement_initial ');
const end=retirementTables.indexOf('CREATE TRIGGER retirement_immutable ');
const original=retirementTables.slice(start,end);
const initial=original.replace('BEFORE INSERT ON output_retirement_intents BEGIN',
 `BEFORE INSERT ON output_retirement_intents WHEN rejected_intent_insert_allowed(NEW.attempt_id,NEW.intent_json)!=1 BEGIN`);
const charges=['spool_bytes','snapshot_bytes','checkpoint_bytes','hold_bytes','collection_bytes','source_bytes','delivery_bytes','absence_bytes','cleanup_control_bytes'];
// Each component is already bounded by quota_bytes; subtraction avoids summing unsafe input.
const remaining=charges.reduce((expression,name)=>`(${expression}-NEW.${name})`,'NEW.quota_bytes');
/** New controls have no backfill and cannot be fabricated by raw SQL or an admitted C1 branch. */
export const migration023=`
CREATE TABLE rejected_cleanup_storage(
 id INTEGER PRIMARY KEY CHECK(id=1),
 original_count INTEGER NOT NULL CHECK(typeof(original_count)='integer' AND original_count BETWEEN 0 AND 64),
 charged_bytes INTEGER NOT NULL CHECK(typeof(charged_bytes)='integer' AND charged_bytes=original_count*16384),
 last_clock INTEGER NOT NULL CHECK(typeof(last_clock)='integer' AND last_clock BETWEEN 0 AND 9007199254740991)
);
INSERT INTO rejected_cleanup_storage VALUES(1,0,0,0);
CREATE TABLE rejected_cleanup_controls(
 attempt_id TEXT PRIMARY KEY REFERENCES accepted_attempts(attempt_id),
 request_digest TEXT NOT NULL CHECK(length(request_digest)=64),
 namespace_identity TEXT NOT NULL REFERENCES installed_staging_namespace(namespace_identity),
 control_json TEXT NOT NULL CHECK(typeof(control_json)='text' AND length(CAST(control_json AS BLOB))<=1024 AND json_valid(control_json)),
 charged_bytes INTEGER NOT NULL CHECK(charged_bytes=16384),
 CHECK(attempt_id=json_extract(control_json,'$.attemptId')),
 CHECK(request_digest=json_extract(control_json,'$.requestDigest')),
 CHECK(namespace_identity=json_extract(control_json,'$.namespaceIdentity')),
 CHECK(charged_bytes=json_extract(control_json,'$.reservedBytes'))
);
CREATE TRIGGER rejected_control_insert BEFORE INSERT ON rejected_cleanup_controls
 WHEN rejected_control_insert_allowed(NEW.attempt_id,NEW.control_json)!=1
 OR EXISTS(SELECT 1 FROM rejected_cleanup_controls WHERE attempt_id=NEW.attempt_id)
 BEGIN SELECT RAISE(ABORT,'unauthorized rejected cleanup control'); END;
CREATE TRIGGER rejected_control_immutable BEFORE UPDATE ON rejected_cleanup_controls
 BEGIN SELECT RAISE(ABORT,'immutable rejected cleanup control'); END;
CREATE TRIGGER rejected_control_retained BEFORE DELETE ON rejected_cleanup_controls
 BEGIN SELECT RAISE(ABORT,'retained rejected cleanup control'); END;
CREATE TRIGGER rejected_control_charge AFTER INSERT ON rejected_cleanup_controls BEGIN
 UPDATE rejected_cleanup_storage SET original_count=original_count+1,charged_bytes=charged_bytes+16384,last_clock=rejected_funding_clock() WHERE id=1;
 SELECT CASE WHEN changes()!=1 THEN RAISE(ABORT,'missing rejected cleanup counter') END;
END;
CREATE TRIGGER rejected_stats_insert BEFORE INSERT ON rejected_cleanup_storage BEGIN SELECT RAISE(ABORT,'fixed rejected cleanup counter'); END;
CREATE TRIGGER rejected_stats_delete BEFORE DELETE ON rejected_cleanup_storage BEGIN SELECT RAISE(ABORT,'retained rejected cleanup counter'); END;
CREATE TRIGGER rejected_stats_update BEFORE UPDATE ON rejected_cleanup_storage
 WHEN rejected_control_stats_allowed(json_array(OLD.original_count,OLD.charged_bytes,OLD.last_clock),
 json_array(NEW.original_count,NEW.charged_bytes,NEW.last_clock))!=1
 BEGIN SELECT RAISE(ABORT,'unauthorized rejected cleanup counter'); END;
CREATE TRIGGER rejected_control_quota BEFORE UPDATE ON accepted_attempts
 WHEN EXISTS(SELECT 1 FROM rejected_cleanup_controls WHERE attempt_id=OLD.attempt_id) AND ${remaining}<16384
 BEGIN SELECT RAISE(ABORT,'reserved rejected cleanup quota'); END;
DROP TRIGGER retirement_initial;
${initial}
DROP TRIGGER settlement_output_retirement_intents_insert;
CREATE TRIGGER settlement_output_retirement_intents_insert BEFORE INSERT ON output_retirement_intents
 WHEN agent_settlement_active()=1 AND rejected_intent_insert_allowed(NEW.attempt_id,NEW.intent_json)!=1
 BEGIN SELECT RAISE(ABORT,'settlement isolation'); END;
CREATE TRIGGER rejected_intent_duplicate BEFORE INSERT ON output_retirement_intents
 WHEN EXISTS(SELECT 1 FROM output_retirement_intents WHERE attempt_id=NEW.attempt_id)
 BEGIN SELECT RAISE(ABORT,'invalid retirement original'); END;
CREATE TRIGGER rejected_retired_queue_insert BEFORE INSERT ON admission_queue
 WHEN EXISTS(SELECT 1 FROM output_retirement_intents WHERE attempt_id=NEW.attempt_id) AND NEW.pending!=0
 BEGIN SELECT RAISE(ABORT,'retired rejected producer'); END;
PRAGMA user_version=23;
`;

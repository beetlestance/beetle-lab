import { BACKEND_CLEANUP_CONTROL_BYTES } from '../../../ports/cleanup-control.js';
const safe=(name:string)=>`${name} INTEGER NOT NULL CHECK(typeof(${name})='integer' AND ${name} BETWEEN 0 AND 9007199254740991)`;
const owned=(row='NEW')=>`EXISTS(SELECT 1 FROM backend_cleanup_controls c WHERE c.attempt_id=${row}.attempt_id
 AND c.run_id=${row}.run_id AND c.organization_id=${row}.organization_id AND c.workspace_id=${row}.workspace_id)`;
const identity=(name:string)=>`${name} TEXT NOT NULL CHECK(length(CAST(${name} AS BLOB))=36 AND ${name}=lower(${name}))`;
const intentFits=(r:string)=>`length(CAST(${r}.request_id AS BLOB))=36 AND length(CAST(${r}.requested_at AS BLOB))=24
 AND typeof(${r}.run_version)='integer' AND ${r}.run_version BETWEEN 1 AND 9007199254740991`;
const fileFits=`length(CAST(NEW.deletion_id AS BLOB))=36 AND length(CAST(NEW.attempt_id AS BLOB))=36
 AND typeof(NEW.original_version)='integer' AND NEW.original_version BETWEEN 1 AND 9007199254740991`;
const fileCost=`length(CAST(json_array(NEW.deletion_id,NEW.attempt_id,NEW.ordinal,NEW.original_version,NEW.version,
 NEW.namespace_identity,NEW.preparation_identity,NEW.absent) AS BLOB))+128`;
/** Dedicated backend reservation; existing rows/counters remain unchanged. */
export const migration021=`
CREATE TABLE backend_cleanup_controls (
 ${identity('attempt_id')},${identity('run_id')},${identity('organization_id')},${identity('workspace_id')},
 policy_version INTEGER NOT NULL CHECK(policy_version=1),reserved_bytes INTEGER NOT NULL CHECK(reserved_bytes=${BACKEND_CLEANUP_CONTROL_BYTES}),
 ${safe('allocation_bytes')},${safe('reserve_bytes')},PRIMARY KEY(attempt_id),UNIQUE(run_id),CHECK(reserve_bytes<=allocation_bytes),
 FOREIGN KEY(attempt_id,run_id,organization_id,workspace_id) REFERENCES attempts(id,run_id,organization_id,workspace_id));
CREATE TRIGGER cleanup_control_insert BEFORE INSERT ON backend_cleanup_controls BEGIN
 SELECT CASE WHEN EXISTS(SELECT 1 FROM backend_cleanup_controls WHERE attempt_id=NEW.attempt_id OR run_id=NEW.run_id)
 OR NOT EXISTS(SELECT 1 FROM attempts a JOIN runs r ON r.id=a.run_id WHERE a.id=NEW.attempt_id AND r.active_attempt_id=a.id AND a.foundation_owned=1)
 OR EXISTS(SELECT 1 FROM output_deletion_intents d WHERE d.attempt_id=NEW.attempt_id AND NOT(${intentFits('d')}))
 THEN RAISE(ABORT,'retained cleanup original') END;
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM settings s CROSS JOIN installation_storage_usage u
 WHERE s.scope_key='installation' AND u.id=1 AND NEW.allocation_bytes<=json_extract(s.value_json,'$.pool.storageBytes')
 AND NEW.reserve_bytes>=json_extract(s.value_json,'$.pool.freeSpaceReserveBytes')
 AND u.charged_bytes<=NEW.allocation_bytes-NEW.reserve_bytes
 AND NEW.reserved_bytes<=NEW.allocation_bytes-NEW.reserve_bytes-u.charged_bytes)
 THEN RAISE(ABORT,'cleanup control capacity') END; END;
CREATE TRIGGER cleanup_control_charge AFTER INSERT ON backend_cleanup_controls BEGIN
 UPDATE installation_storage_usage SET charged_bytes=charged_bytes+NEW.reserved_bytes WHERE id=1; END;
CREATE TRIGGER cleanup_control_immutable BEFORE UPDATE ON backend_cleanup_controls BEGIN SELECT RAISE(ABORT,'immutable cleanup control'); END;
CREATE TRIGGER cleanup_control_retained BEFORE DELETE ON backend_cleanup_controls BEGIN SELECT RAISE(ABORT,'retained cleanup control'); END;
CREATE TRIGGER cleanup_control_delivery BEFORE UPDATE OF possible_delivery ON dispatch_outbox WHEN OLD.possible_delivery=0 AND NEW.possible_delivery=1 BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM backend_cleanup_controls WHERE attempt_id=NEW.attempt_id AND policy_version=1)
 THEN RAISE(ABORT,'delivery requires cleanup control') END; END;
CREATE TRIGGER cleanup_control_deletion BEFORE INSERT ON output_deletion_intents WHEN NOT(${owned()} AND ${intentFits('NEW')})
 BEGIN SELECT RAISE(ABORT,'deletion requires cleanup control'); END;
${['INSERT','UPDATE'].map((event,index)=>`CREATE TRIGGER cleanup_control_${index===0?'file_insert':'file'} BEFORE ${event} ON output_deletion_files BEGIN
 SELECT CASE WHEN NOT(${fileFits}) OR NOT EXISTS(
 SELECT 1 FROM backend_cleanup_controls c WHERE c.attempt_id=NEW.attempt_id AND EXISTS(
 SELECT 1 FROM output_deletion_intents d WHERE d.id=NEW.deletion_id AND d.run_id=c.run_id
 AND d.organization_id=c.organization_id AND d.workspace_id=c.workspace_id))
 THEN RAISE(ABORT,'file progress requires cleanup control') END;
 SELECT CASE WHEN ${fileCost}>384 THEN RAISE(ABORT,'cleanup file budget') END; END;`).join('\n')}
PRAGMA user_version=21;
`;

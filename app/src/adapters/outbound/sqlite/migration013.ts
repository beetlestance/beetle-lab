import { RUN_OUTPUT_METADATA_BYTES } from '../../../ports/dispatch.js';
import { unsentWitness } from './output-deletion/unsent.js';
const hash = (name: string) => `(typeof(${name})='text' AND length(${name})=64 AND ${name} NOT GLOB '*[^0-9a-f]*')`;
const settled = (table: string, kind: string, digest: string) => `NEW.kind='${kind}' AND EXISTS(
 SELECT 1 FROM ${table} f JOIN execution_records e ON e.attempt_id=f.attempt_id
 WHERE f.attempt_id=NEW.attempt_id AND f.run_id=NEW.run_id AND f.organization_id=NEW.organization_id
 AND f.workspace_id=NEW.workspace_id AND f.run_version=NEW.run_version AND f.${digest}=NEW.closure_digest
 AND f.retained_payload_bytes=NEW.retained_payload_bytes AND e.execution_charged=0 AND e.event_pending=0)
 AND NEW.metadata_bytes=${RUN_OUTPUT_METADATA_BYTES}`;
/** Retains every old authority/charge; no purge or refund authority is introduced. */
export const migration013 = `
CREATE TABLE output_deletion_intents (
 sequence INTEGER PRIMARY KEY AUTOINCREMENT CHECK(sequence BETWEEN 1 AND 9007199254740991),id TEXT NOT NULL UNIQUE CHECK(length(id)=36 AND id=lower(id)),
 run_id TEXT NOT NULL UNIQUE,attempt_id TEXT NOT NULL,organization_id TEXT NOT NULL,workspace_id TEXT NOT NULL,
 request_id TEXT NOT NULL,run_version INTEGER NOT NULL CHECK(run_version>=1),deletion_version INTEGER NOT NULL CHECK(deletion_version=1),
 version INTEGER NOT NULL CHECK(version BETWEEN 1 AND 257),kind TEXT NOT NULL CHECK(kind IN ('source','absence','unsent')),
 requested_at TEXT NOT NULL CHECK(length(requested_at)=24),closure_digest TEXT,
 retained_payload_bytes INTEGER NOT NULL CHECK(typeof(retained_payload_bytes)='integer' AND retained_payload_bytes BETWEEN 0 AND 9007199254740991),
 metadata_bytes INTEGER NOT NULL CHECK(metadata_bytes IN (0,${RUN_OUTPUT_METADATA_BYTES})),
 file_count INTEGER NOT NULL CHECK(file_count BETWEEN 0 AND 128),pending_files INTEGER NOT NULL CHECK(pending_files BETWEEN 0 AND file_count),
 namespace_identity TEXT CHECK(namespace_identity IS NULL OR ${hash('namespace_identity')}),
 CHECK((kind='unsent' AND closure_digest IS NULL AND retained_payload_bytes=0 AND metadata_bytes=0 AND file_count=0)
 OR (kind IN ('source','absence') AND closure_digest IS NOT NULL AND ${hash('closure_digest')})),
 CHECK(kind='source' OR file_count=0),UNIQUE(id,attempt_id),
 FOREIGN KEY(run_id,organization_id,workspace_id) REFERENCES runs(id,organization_id,workspace_id),
 FOREIGN KEY(attempt_id,run_id,organization_id,workspace_id) REFERENCES attempts(id,run_id,organization_id,workspace_id));
CREATE INDEX output_deletion_pending ON output_deletion_intents(sequence) WHERE pending_files>0;
CREATE TABLE output_deletion_files (
 deletion_id TEXT NOT NULL,attempt_id TEXT NOT NULL,ordinal INTEGER NOT NULL CHECK(ordinal BETWEEN 0 AND 127),
 original_version INTEGER NOT NULL CHECK(typeof(original_version)='integer' AND original_version>=1),
 version INTEGER NOT NULL CHECK(version IN (1,2,3)),namespace_identity TEXT,preparation_identity TEXT,
 absent INTEGER NOT NULL CHECK(absent IN (0,1)),PRIMARY KEY(deletion_id,ordinal),
 CHECK((version=1 AND namespace_identity IS NULL AND preparation_identity IS NULL AND absent=0)
 OR(version IN (2,3) AND namespace_identity IS NOT NULL AND preparation_identity IS NOT NULL AND ${hash('namespace_identity')} AND ${hash('preparation_identity')} AND absent=version-2)),
 FOREIGN KEY(deletion_id,attempt_id) REFERENCES output_deletion_intents(id,attempt_id),
 FOREIGN KEY(attempt_id,ordinal) REFERENCES execution_output_slots(attempt_id,ordinal));
CREATE TRIGGER output_deletion_begin BEFORE INSERT ON output_deletion_intents BEGIN
 SELECT CASE WHEN EXISTS(SELECT 1 FROM output_deletion_intents WHERE id=NEW.id OR run_id=NEW.run_id)
 OR NEW.version!=1 OR NEW.pending_files!=NEW.file_count OR NEW.namespace_identity IS NOT NULL
 OR NOT EXISTS(SELECT 1 FROM runs r WHERE r.id=NEW.run_id AND r.organization_id=NEW.organization_id AND r.workspace_id=NEW.workspace_id
 AND r.active_attempt_id=NEW.attempt_id AND r.version=NEW.run_version AND r.state IN ('finished','cancelled','errored') AND r.outcome!='pending')
 THEN RAISE(ABORT,'deletion requires captured terminal original') END;
 SELECT CASE WHEN NOT ((NEW.kind='unsent' AND EXISTS(SELECT 1 FROM attempts a WHERE a.id=NEW.attempt_id AND ${unsentWitness}))
 OR (${settled('execution_output_finalizations','source','source_digest')}
 AND NEW.file_count=(SELECT count(*) FROM execution_output_slots WHERE attempt_id=NEW.attempt_id))
 OR (${settled('execution_output_absence_finalizations','absence','proof_digest')}))
 THEN RAISE(ABORT,'deletion requires settled custody') END;
END;
CREATE TRIGGER output_deletion_file_insert BEFORE INSERT ON output_deletion_files BEGIN
 SELECT CASE WHEN EXISTS(SELECT 1 FROM output_deletion_files WHERE deletion_id=NEW.deletion_id AND ordinal=NEW.ordinal)
 OR NEW.version!=1 OR NOT EXISTS(SELECT 1 FROM output_deletion_intents d JOIN execution_output_slots s ON s.attempt_id=d.attempt_id
 WHERE d.id=NEW.deletion_id AND d.kind='source' AND s.ordinal=NEW.ordinal AND NEW.ordinal<d.file_count
 AND json_extract(s.slot_json,'$.v')=NEW.original_version AND json_extract(s.slot_json,'$.p')='published'
 AND json_extract(s.slot_json,'$.i') IS NOT NULL AND json_extract(s.slot_json,'$.w') IS NULL)
 THEN RAISE(ABORT,'deletion requires captured published slot') END;
END;
CREATE TRIGGER output_deletion_file_update BEFORE UPDATE ON output_deletion_files BEGIN
 SELECT CASE WHEN NEW.deletion_id IS NOT OLD.deletion_id OR NEW.attempt_id IS NOT OLD.attempt_id OR NEW.ordinal IS NOT OLD.ordinal
 OR NEW.original_version IS NOT OLD.original_version OR NEW.version!=OLD.version+1 OR NOT (
 (OLD.version=1 AND NEW.version=2 AND EXISTS(SELECT 1 FROM output_deletion_intents d WHERE d.id=NEW.deletion_id
 AND(d.namespace_identity IS NULL OR d.namespace_identity=NEW.namespace_identity)))
 OR(OLD.version=2 AND NEW.version=3 AND NEW.namespace_identity IS OLD.namespace_identity AND NEW.preparation_identity IS OLD.preparation_identity))
 THEN RAISE(ABORT,'monotonic deletion progress') END;
END;
CREATE TRIGGER output_deletion_progress AFTER UPDATE ON output_deletion_files BEGIN
 UPDATE output_deletion_intents SET version=version+1,pending_files=pending_files-(NEW.absent-OLD.absent),
 namespace_identity=coalesce(namespace_identity,NEW.namespace_identity) WHERE id=NEW.deletion_id;
END;
CREATE TRIGGER output_deletion_intent_update BEFORE UPDATE ON output_deletion_intents BEGIN
 SELECT CASE WHEN NEW.sequence IS NOT OLD.sequence OR NEW.id IS NOT OLD.id OR NEW.run_id IS NOT OLD.run_id
 OR NEW.attempt_id IS NOT OLD.attempt_id OR NEW.organization_id IS NOT OLD.organization_id OR NEW.workspace_id IS NOT OLD.workspace_id
 OR NEW.request_id IS NOT OLD.request_id OR NEW.run_version IS NOT OLD.run_version OR NEW.deletion_version IS NOT OLD.deletion_version
 OR NEW.kind IS NOT OLD.kind OR NEW.requested_at IS NOT OLD.requested_at
 OR NEW.closure_digest IS NOT OLD.closure_digest OR NEW.retained_payload_bytes IS NOT OLD.retained_payload_bytes OR NEW.metadata_bytes IS NOT OLD.metadata_bytes
 OR NEW.file_count IS NOT OLD.file_count OR NEW.version!=OLD.version+1
 OR NEW.version!=1+(SELECT coalesce(sum(version-1),0) FROM output_deletion_files WHERE deletion_id=OLD.id)
 OR NEW.pending_files!=(SELECT count(*) FROM output_deletion_files WHERE deletion_id=OLD.id AND absent=0)
 OR(OLD.namespace_identity IS NOT NULL AND NEW.namespace_identity IS NOT OLD.namespace_identity)
 OR EXISTS(SELECT 1 FROM output_deletion_files WHERE deletion_id=OLD.id AND namespace_identity IS NOT NULL AND namespace_identity IS NOT NEW.namespace_identity)
 THEN RAISE(ABORT,'immutable deletion intent') END;
END;
CREATE TRIGGER output_deletion_intent_retained BEFORE DELETE ON output_deletion_intents BEGIN SELECT RAISE(ABORT,'retained deletion intent'); END;
CREATE TRIGGER output_deletion_file_retained BEFORE DELETE ON output_deletion_files BEGIN SELECT RAISE(ABORT,'retained deletion progress'); END;
PRAGMA user_version=13;
`;

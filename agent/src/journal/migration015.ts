import { parentGuards } from './disk-retention/guards.js';
import { Failure } from './sql.js';
import type { DatabaseSync } from 'node:sqlite';
import { EXPORT_ASSIGNMENT_BYTES } from '@beetle/contracts';
/** Full immutable carrier remains independent of performance result projections. */
export function migration015(db: DatabaseSync): void {
  db.exec(`ALTER TABLE accepted_attempts ADD COLUMN execution_purpose TEXT NOT NULL DEFAULT 'performance' CHECK(execution_purpose IN ('performance','standalone_export'));
  CREATE TRIGGER execution_purpose_immutable BEFORE UPDATE OF execution_purpose ON accepted_attempts
    WHEN NEW.execution_purpose IS NOT OLD.execution_purpose BEGIN SELECT RAISE(ABORT,'immutable_execution_purpose'); END;
  CREATE TABLE export_assignments (
    attempt_id TEXT PRIMARY KEY REFERENCES accepted_attempts(attempt_id),
    assignment_digest TEXT NOT NULL CHECK(length(assignment_digest)=64 AND assignment_digest NOT GLOB '*[^0-9a-f]*'),
    assignment_json TEXT NOT NULL CHECK(length(CAST(assignment_json AS BLOB)) BETWEEN 1 AND ${EXPORT_ASSIGNMENT_BYTES})
  );
  CREATE TRIGGER export_assignment_insert BEFORE INSERT ON export_assignments BEGIN
    SELECT CASE WHEN EXISTS(SELECT 1 FROM export_assignments WHERE attempt_id=NEW.attempt_id)
      THEN RAISE(ABORT,'existing_export_assignment') END;
    SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM accepted_attempts a WHERE a.attempt_id=NEW.attempt_id
      AND a.execution_purpose='standalone_export' AND a.state='offered' AND a.last_seq=0 AND a.cancel_requested=0
      AND NOT EXISTS(SELECT 1 FROM admission_queue q WHERE q.attempt_id=a.attempt_id)
      AND NOT EXISTS(SELECT 1 FROM reservations r WHERE r.attempt_id=a.attempt_id)
      AND json_extract(NEW.assignment_json,'$.purpose')='standalone_export'
      AND json_extract(NEW.assignment_json,'$.assignmentDigest')=NEW.assignment_digest
      AND json_extract(NEW.assignment_json,'$.offer.attemptId')=a.attempt_id
      AND json_extract(NEW.assignment_json,'$.offer.organizationId')=a.organization_id
      AND json_extract(NEW.assignment_json,'$.offer.workspaceId')=a.workspace_id
      AND json_extract(NEW.assignment_json,'$.offer.intentDigest')=a.intent_digest)
      THEN RAISE(ABORT,'export_assignment_original') END;
  END;
  CREATE TRIGGER export_assignment_immutable BEFORE UPDATE ON export_assignments BEGIN SELECT RAISE(ABORT,'export_assignment_immutable'); END;
  CREATE TRIGGER export_assignment_retained BEFORE DELETE ON export_assignments BEGIN SELECT RAISE(ABORT,'export_assignment_retained'); END;
  ALTER TABLE accepted_attempts ADD COLUMN export_result_json TEXT CHECK(export_result_json IS NULL OR length(CAST(export_result_json AS BLOB))<=8192);
  CREATE TRIGGER result_purpose_exclusive BEFORE UPDATE OF result_json,export_result_json ON accepted_attempts
    WHEN NEW.result_json IS NOT NULL AND NEW.export_result_json IS NOT NULL BEGIN SELECT RAISE(ABORT,'mixed_result_purpose'); END;
  CREATE TRIGGER export_result_authority BEFORE UPDATE OF export_result_json ON accepted_attempts
    WHEN NEW.export_result_json IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM export_assignments e WHERE e.attempt_id=NEW.attempt_id
      AND e.assignment_digest=json_extract(NEW.export_result_json,'$.assignmentDigest'))
    BEGIN SELECT RAISE(ABORT,'export_result_authority'); END;
  CREATE TRIGGER performance_result_authority BEFORE UPDATE OF result_json ON accepted_attempts
    WHEN NEW.result_json IS NOT NULL AND EXISTS (SELECT 1 FROM export_assignments e WHERE e.attempt_id=NEW.attempt_id)
    BEGIN SELECT RAISE(ABORT,'performance_result_authority'); END;
  CREATE TRIGGER export_result_custody_fence BEFORE UPDATE OF export_result_json ON accepted_attempts
    WHEN NEW.export_result_json IS NOT OLD.export_result_json AND (
      EXISTS(SELECT 1 FROM output_collection_intents WHERE attempt_id=OLD.attempt_id)
      OR EXISTS(SELECT 1 FROM output_delivery_closures WHERE attempt_id=OLD.attempt_id)
      OR EXISTS(SELECT 1 FROM output_absence_closures WHERE attempt_id=OLD.attempt_id))
    BEGIN SELECT RAISE(ABORT,'immutable_export_result'); END;
  CREATE TRIGGER export_reservation_authority BEFORE INSERT ON reservations BEGIN
    SELECT CASE WHEN EXISTS(SELECT 1 FROM export_assignments e WHERE e.attempt_id=NEW.attempt_id)
      THEN CASE WHEN NOT EXISTS(SELECT 1 FROM export_assignments e WHERE e.attempt_id=NEW.attempt_id
        AND json_extract(NEW.reservation_json,'$.assignment.purpose')='standalone_export'
        AND json_extract(NEW.reservation_json,'$.assignment.assignmentDigest')=e.assignment_digest
        AND json_extract(NEW.reservation_json,'$.staging.assignmentBytes')=length(CAST(e.assignment_json AS BLOB)))
        THEN RAISE(ABORT,'export_reservation_authority') END
      ELSE CASE WHEN json_type(NEW.reservation_json,'$.assignment') IS NOT NULL
        OR json_type(NEW.reservation_json,'$.staging.assignmentBytes') IS NOT NULL THEN RAISE(ABORT,'unexpected_export_reservation') END END;
  END;
  CREATE TRIGGER export_reservation_pinned BEFORE UPDATE ON reservations
    WHEN json_extract(NEW.reservation_json,'$.assignment') IS NOT json_extract(OLD.reservation_json,'$.assignment')
    BEGIN SELECT RAISE(ABORT,'immutable_export_reservation'); END;
  PRAGMA user_version=15;`);
  const insert=parentGuards.match(/CREATE TRIGGER disk_reservation_insert BEFORE INSERT ON reservations BEGIN[\s\S]*?\n {2}END;/u)?.[0];
  if (!insert) throw new Failure('unavailable');
  db.exec('DROP TRIGGER disk_reservation_insert');db.exec(insert);
  upgradeSourceResultGuards(db);
}
function upgradeSourceResultGuards(db: DatabaseSync): void {
  for (const name of ['output_intent_validate','output_source_validate']) {
    const row=db.prepare("SELECT CASE WHEN length(CAST(sql AS BLOB))<=65536 THEN sql END AS sql FROM sqlite_master WHERE type='trigger' AND name=?").get(name);
    if (typeof row?.sql !== 'string' || !row.sql.includes('a.result_json')) throw new Failure('unavailable');
    db.exec('DROP TRIGGER '+name);
    db.exec(row.sql.replaceAll('a.result_json','COALESCE(a.export_result_json,a.result_json)'));
  }
}

import { OUTPUT_ABSENCE_BYTES } from '@beetle/contracts/output-source';
import { OUTPUT_ABSENCE_ROW_ALLOWANCE } from './output-absence-protocol.js';
import { absencePending } from './output-absence-facts.js';

export const absenceTables = `
  ALTER TABLE accepted_attempts ADD COLUMN absence_bytes INTEGER NOT NULL DEFAULT 0
    CHECK(typeof(absence_bytes)='integer' AND absence_bytes BETWEEN 0 AND ${OUTPUT_ABSENCE_BYTES + OUTPUT_ABSENCE_ROW_ALLOWANCE});
  ALTER TABLE accepted_attempts ADD COLUMN absence_pending INTEGER NOT NULL DEFAULT 0
    CHECK(typeof(absence_pending)='integer' AND absence_pending IN (0,1));
  CREATE TABLE output_absence_closures (
    attempt_id TEXT PRIMARY KEY REFERENCES accepted_attempts(attempt_id),
    proof_json TEXT NOT NULL CHECK(typeof(proof_json)='text' AND json_valid(proof_json)
      AND length(CAST(proof_json AS BLOB)) BETWEEN 1 AND ${OUTPUT_ABSENCE_BYTES}),
    charged_bytes INTEGER NOT NULL CHECK(typeof(charged_bytes)='integer'
      AND charged_bytes=length(CAST(proof_json AS BLOB))+${OUTPUT_ABSENCE_ROW_ALLOWANCE})
  );
  CREATE INDEX output_absence_pending ON accepted_attempts(id) WHERE absence_pending=1;
`;
const frozen = ['id', 'attempt_id', 'organization_id', 'workspace_id', 'generation', 'intent_digest',
  'offer_json', 'canonical_json', 'state', 'phase', 'last_seq', 'wrapper_high', 'supervisor_high',
  'result_json', 'exit_json', 'exit_facts_json', 'wrapper_checkpoint_json', 'snapshot_bytes', 'checkpoint_bytes'];
export const absenceParentGuards = `
  CREATE TRIGGER absence_parent_insert BEFORE INSERT ON accepted_attempts
    WHEN NEW.absence_bytes!=0 OR NEW.absence_pending!=0
    BEGIN SELECT RAISE(ABORT,'immutable absence parent'); END;
  CREATE TRIGGER absence_parent_update BEFORE UPDATE ON accepted_attempts BEGIN
    SELECT CASE WHEN NEW.absence_bytes!=COALESCE((SELECT charged_bytes FROM output_absence_closures WHERE attempt_id=OLD.attempt_id),0)
      OR NEW.spool_bytes+NEW.snapshot_bytes+NEW.checkpoint_bytes+NEW.hold_bytes+NEW.collection_bytes+NEW.source_bytes+NEW.delivery_bytes+NEW.absence_bytes>NEW.quota_bytes
      THEN RAISE(ABORT,'output absence quota') END;
    SELECT CASE WHEN EXISTS(SELECT 1 FROM output_absence_closures WHERE attempt_id=OLD.attempt_id)
      AND (${frozen.map(name => `NEW.${name} IS NOT OLD.${name}`).join(' OR ')} OR NEW.absence_pending!=0)
      THEN RAISE(ABORT,'closed output absence') END;
  END;
  CREATE TRIGGER absence_pending_update BEFORE UPDATE OF absence_pending ON accepted_attempts
    WHEN NEW.absence_pending!=${absencePending('NEW')}
    BEGIN SELECT RAISE(ABORT,'immutable absence debt'); END;
  CREATE TRIGGER absence_parent_delete BEFORE DELETE ON accepted_attempts
    WHEN EXISTS(SELECT 1 FROM output_absence_closures WHERE attempt_id=OLD.attempt_id)
    BEGIN SELECT RAISE(ABORT,'closed output absence'); END;
`;
const canonicalProof = `json_object('admission',json(f.admission_json),'attemptId',a.attempt_id,'finalAgentSeq',a.last_seq,
  'generation',a.generation,'intentDigest',a.intent_digest,'journalAuthority',(SELECT authority FROM journal_authority WHERE id=1),
  'organizationId',a.organization_id,'reason',f.reason,'version',1,'workspaceId',a.workspace_id)`;
export const absenceGuards = `
  CREATE TRIGGER absence_insert BEFORE INSERT ON output_absence_closures BEGIN
    SELECT CASE WHEN EXISTS(SELECT 1 FROM output_absence_closures WHERE attempt_id=NEW.attempt_id)
      THEN RAISE(ABORT,'immutable output absence') END;
    SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM output_absence_facts f JOIN accepted_attempts a USING(attempt_id)
      WHERE a.attempt_id=NEW.attempt_id AND f.admission_json IS NOT NULL AND NEW.proof_json=${canonicalProof})
      THEN RAISE(ABORT,'invalid output absence') END;
  END;
  CREATE TRIGGER absence_inserted AFTER INSERT ON output_absence_closures BEGIN
    UPDATE accepted_attempts SET absence_bytes=NEW.charged_bytes,absence_pending=0 WHERE attempt_id=NEW.attempt_id;
  END;
  CREATE TRIGGER absence_update BEFORE UPDATE ON output_absence_closures
    BEGIN SELECT RAISE(ABORT,'immutable output absence'); END;
  CREATE TRIGGER absence_delete BEFORE DELETE ON output_absence_closures
    BEGIN SELECT RAISE(ABORT,'immutable output absence'); END;
  CREATE TRIGGER absence_event_insert BEFORE INSERT ON event_spool
    WHEN EXISTS(SELECT 1 FROM output_absence_closures WHERE attempt_id=NEW.attempt_id)
    BEGIN SELECT RAISE(ABORT,'closed output absence'); END;
  CREATE TRIGGER absence_event_update BEFORE UPDATE ON event_spool
    WHEN EXISTS(SELECT 1 FROM output_absence_closures WHERE attempt_id=OLD.attempt_id OR attempt_id=NEW.attempt_id)
    BEGIN SELECT RAISE(ABORT,'closed output absence'); END;
  CREATE TRIGGER absence_event_delete BEFORE DELETE ON event_spool
    WHEN EXISTS(SELECT 1 FROM output_absence_closures WHERE attempt_id=OLD.attempt_id)
      AND OLD.seq>(SELECT acknowledged_seq FROM accepted_attempts WHERE attempt_id=OLD.attempt_id)
    BEGIN SELECT RAISE(ABORT,'unacknowledged output absence'); END;
`;
function fence(table: string, columns: readonly string[]): string {
  return `CREATE TRIGGER absence_${table}_insert BEFORE INSERT ON ${table}
    WHEN EXISTS(SELECT 1 FROM output_absence_closures WHERE attempt_id=NEW.attempt_id)
    BEGIN SELECT RAISE(ABORT,'closed output absence'); END;
    CREATE TRIGGER absence_${table}_update BEFORE UPDATE ON ${table}
    WHEN EXISTS(SELECT 1 FROM output_absence_closures WHERE attempt_id=OLD.attempt_id OR attempt_id=NEW.attempt_id)
      AND (${columns.map(name => `NEW.${name} IS NOT OLD.${name}`).join(' OR ')})
    BEGIN SELECT RAISE(ABORT,'closed output absence'); END;
    CREATE TRIGGER absence_${table}_delete BEFORE DELETE ON ${table}
    WHEN EXISTS(SELECT 1 FROM output_absence_closures WHERE attempt_id=OLD.attempt_id)
    BEGIN SELECT RAISE(ABORT,'closed output absence'); END;`;
}
export const absenceFences = [
  fence('reservations', ['id', 'attempt_id', 'reservation_json', 'charged']),
  fence('admission_queue', ['id', 'attempt_id', 'candidate_json', 'decision_json', 'pending']),
  fence('output_collection_intents', ['attempt_id', 'collection_id', 'intent_json', 'charged_bytes', 'phase', 'created_epoch']),
  fence('output_sources', ['attempt_id', 'source_json', 'manifest_digest', 'source_digest', 'charged_bytes']),
  fence('output_delivery_closures', ['attempt_id', 'closure_json', 'charged_bytes']),
  fence('cancelled_originals', ['attempt_id', 'generation']),
].join('\n');
export const absenceDebt = ['admission_queue', 'reservations', 'cancelled_originals'].map(table =>
  ['INSERT', 'UPDATE'].map(event => `CREATE TRIGGER absence_debt_${table}_${event.toLowerCase()} AFTER ${event} ON ${table} BEGIN
    UPDATE accepted_attempts SET absence_pending=${absencePending('accepted_attempts')} WHERE attempt_id=NEW.attempt_id;
  END;`).join('\n')).join('\n');

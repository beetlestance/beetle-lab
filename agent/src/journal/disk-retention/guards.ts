import { DISK_HOLD_METADATA_BYTES, MAX_RESOURCE_VALUE } from '../../admission/index.js';

const pinned = ['attemptId', 'organizationId', 'workspaceId', 'generation', 'resources', 'budget', 'staging'];
const unchanged = pinned.map(name => `json_extract(NEW.reservation_json,'$.${name}') IS json_extract(OLD.reservation_json,'$.${name}')`).join(' AND ');
const matchesCandidate = ['resources', 'budget', 'staging'].map(name =>
  `json_extract(NEW.reservation_json,'$.${name}') IS json_extract(q.candidate_json,'$.${name}')`).join(' AND ');
const stagingFields = ['offerBytes', 'inputBytes', 'secretBytes', 'manifestBytes', 'metadataBytes'];
const stagingInteger = stagingFields.map(name => `json_type(NEW.reservation_json,'$.staging.${name}')='integer'
  AND json_extract(NEW.reservation_json,'$.staging.${name}') BETWEEN 0 AND ${MAX_RESOURCE_VALUE}`).join(' AND ');
const stagingSum = stagingFields.map(name => `json_extract(NEW.reservation_json,'$.staging.${name}')`).join('+')
  + "+COALESCE(json_extract(NEW.reservation_json,'$.staging.assignmentBytes'),0)";

/** Parent guards keep the immutable original and the hold's phase inseparable. */
export const parentGuards = `
  CREATE TRIGGER disk_parent_insert BEFORE INSERT ON accepted_attempts
    WHEN NEW.hold_bytes!=0 OR EXISTS(SELECT 1 FROM accepted_attempts WHERE attempt_id=NEW.attempt_id)
    BEGIN SELECT RAISE(ABORT,'immutable disk parent'); END;
  CREATE TRIGGER disk_parent_update BEFORE UPDATE ON accepted_attempts BEGIN
    SELECT CASE WHEN NEW.hold_bytes!=CASE WHEN EXISTS(SELECT 1 FROM disk_holds WHERE attempt_id=OLD.attempt_id) THEN ${DISK_HOLD_METADATA_BYTES} ELSE 0 END
      OR NEW.hold_bytes+NEW.spool_bytes+NEW.snapshot_bytes+NEW.checkpoint_bytes>NEW.quota_bytes
      THEN RAISE(ABORT,'disk hold quota') END;
    SELECT CASE WHEN EXISTS(SELECT 1 FROM disk_holds h WHERE h.attempt_id=OLD.attempt_id
      AND (NEW.attempt_id IS NOT OLD.attempt_id OR NEW.organization_id IS NOT h.organization_id
        OR NEW.workspace_id IS NOT h.workspace_id OR NEW.generation IS NOT h.generation OR NEW.intent_digest IS NOT h.intent_digest))
      THEN RAISE(ABORT,'immutable disk parent') END;
  END;
  CREATE TRIGGER disk_reservation_insert BEFORE INSERT ON reservations BEGIN
    SELECT CASE WHEN EXISTS(SELECT 1 FROM reservations WHERE attempt_id=NEW.attempt_id)
      THEN RAISE(ABORT,'immutable disk reservation') END;
    SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM accepted_attempts a JOIN admission_queue q USING(attempt_id)
      WHERE a.attempt_id=NEW.attempt_id AND NEW.charged=1
      AND json_extract(NEW.reservation_json,'$.status')='charged'
      AND json_extract(NEW.reservation_json,'$.attemptId')=a.attempt_id
      AND json_extract(NEW.reservation_json,'$.organizationId')=a.organization_id
      AND json_extract(NEW.reservation_json,'$.workspaceId')=a.workspace_id
      AND json_extract(NEW.reservation_json,'$.generation')=a.generation AND ${matchesCandidate}
      AND json_type(NEW.reservation_json,'$.resources.outputBytes')='integer'
      AND json_extract(NEW.reservation_json,'$.resources.outputBytes') BETWEEN 1 AND ${MAX_RESOURCE_VALUE}
      AND json_extract(NEW.reservation_json,'$.budget.outputBytes')=json_extract(NEW.reservation_json,'$.resources.outputBytes')
      AND json_type(NEW.reservation_json,'$.resources.stagingBytes')='integer'
      AND json_extract(NEW.reservation_json,'$.resources.stagingBytes') BETWEEN 0 AND ${MAX_RESOURCE_VALUE}
      AND (json_type(NEW.reservation_json,'$.staging.assignmentBytes') IS NULL OR (json_type(NEW.reservation_json,'$.staging.assignmentBytes')='integer'
        AND json_extract(NEW.reservation_json,'$.staging.assignmentBytes') BETWEEN 1 AND 2105344))
      AND json_extract(NEW.reservation_json,'$.staging.policyVersion')=1 AND ${stagingInteger}
      AND json_extract(NEW.reservation_json,'$.staging.manifestBytes')=65536
      AND json_extract(NEW.reservation_json,'$.staging.metadataBytes')=65536
      AND json_extract(NEW.reservation_json,'$.staging.totalBytes')=${stagingSum}
      AND json_extract(NEW.reservation_json,'$.resources.stagingBytes')=${stagingSum})
      THEN RAISE(ABORT,'invalid disk original') END;
  END;
  CREATE TRIGGER disk_reservation_inserted AFTER INSERT ON reservations BEGIN
    INSERT INTO disk_holds SELECT NEW.attempt_id,organization_id,workspace_id,generation,intent_digest,
      json_extract(NEW.reservation_json,'$.resources.outputBytes'),json_extract(NEW.reservation_json,'$.resources.stagingBytes'),
      ${DISK_HOLD_METADATA_BYTES},'active' FROM accepted_attempts WHERE attempt_id=NEW.attempt_id;
  END;
  CREATE TRIGGER disk_reservation_update BEFORE UPDATE ON reservations BEGIN
    SELECT CASE WHEN NEW.id IS NOT OLD.id OR NEW.attempt_id IS NOT OLD.attempt_id OR NOT(${unchanged})
      OR NEW.charged>OLD.charged
      OR json_extract(NEW.reservation_json,'$.status') IS NOT CASE NEW.charged WHEN 1 THEN 'charged' ELSE 'released' END
      OR NOT EXISTS(SELECT 1 FROM disk_holds WHERE attempt_id=OLD.attempt_id
        AND phase=CASE OLD.charged WHEN 1 THEN 'active' ELSE 'retained' END)
      THEN RAISE(ABORT,'immutable disk reservation') END;
  END;
  CREATE TRIGGER disk_reservation_updated AFTER UPDATE OF charged ON reservations WHEN OLD.charged=1 AND NEW.charged=0 BEGIN
    UPDATE disk_holds SET phase='retained' WHERE attempt_id=NEW.attempt_id;
  END;
  CREATE TRIGGER disk_reservation_delete BEFORE DELETE ON reservations
    BEGIN SELECT RAISE(ABORT,'immutable disk reservation'); END;
`;

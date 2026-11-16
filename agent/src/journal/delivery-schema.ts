import { OUTPUT_DELIVERY_BYTES, OUTPUT_DELIVERY_ROW_ALLOWANCE } from './output-delivery-protocol.js';

export const deliveryTables = `
  ALTER TABLE accepted_attempts ADD COLUMN delivery_bytes INTEGER NOT NULL DEFAULT 0
    CHECK(typeof(delivery_bytes)='integer' AND delivery_bytes BETWEEN 0 AND ${OUTPUT_DELIVERY_BYTES + OUTPUT_DELIVERY_ROW_ALLOWANCE}
      AND spool_bytes+snapshot_bytes+checkpoint_bytes+hold_bytes+collection_bytes+source_bytes+delivery_bytes<=quota_bytes);
  ALTER TABLE accepted_attempts ADD COLUMN delivery_pending INTEGER NOT NULL DEFAULT 0
    CHECK(typeof(delivery_pending)='integer' AND delivery_pending IN (0,1));
  CREATE TABLE output_delivery_closures (
    attempt_id TEXT PRIMARY KEY REFERENCES output_sources(attempt_id),
    closure_json TEXT NOT NULL CHECK(typeof(closure_json)='text' AND json_valid(closure_json)
      AND length(CAST(closure_json AS BLOB)) BETWEEN 1 AND ${OUTPUT_DELIVERY_BYTES}),
    charged_bytes INTEGER NOT NULL CHECK(typeof(charged_bytes)='integer'
      AND charged_bytes=length(CAST(closure_json AS BLOB))+${OUTPUT_DELIVERY_ROW_ALLOWANCE}
      AND charged_bytes BETWEEN 257 AND ${OUTPUT_DELIVERY_BYTES + OUTPUT_DELIVERY_ROW_ALLOWANCE})
  );
  CREATE INDEX output_delivery_pending ON accepted_attempts(id) WHERE delivery_pending=1;
`;
const exactCharge = (table: string): string => `COALESCE((SELECT charged_bytes FROM ${table} WHERE attempt_id=OLD.attempt_id),0)`;
const pending = `CASE WHEN EXISTS(SELECT 1 FROM output_sources WHERE attempt_id=OLD.attempt_id)
  AND NOT EXISTS(SELECT 1 FROM output_delivery_closures WHERE attempt_id=OLD.attempt_id) THEN 1 ELSE 0 END`;
export const deliveryParentGuards = `
  DROP TRIGGER disk_parent_update;
  CREATE TRIGGER disk_parent_update BEFORE UPDATE ON accepted_attempts BEGIN
    SELECT CASE WHEN NEW.hold_bytes!=CASE WHEN EXISTS(SELECT 1 FROM disk_holds WHERE attempt_id=OLD.attempt_id) THEN 512 ELSE 0 END
      OR NEW.collection_bytes!=${exactCharge('output_collection_intents')} OR NEW.source_bytes!=${exactCharge('output_sources')}
      OR NEW.delivery_bytes!=${exactCharge('output_delivery_closures')} OR NEW.delivery_pending!=${pending}
      OR NEW.hold_bytes+NEW.spool_bytes+NEW.snapshot_bytes+NEW.checkpoint_bytes+NEW.collection_bytes+NEW.source_bytes+NEW.delivery_bytes>NEW.quota_bytes
      THEN RAISE(ABORT,'output delivery quota') END;
    SELECT CASE WHEN EXISTS(SELECT 1 FROM disk_holds h WHERE h.attempt_id=OLD.attempt_id
      AND (NEW.attempt_id IS NOT OLD.attempt_id OR NEW.organization_id IS NOT h.organization_id
        OR NEW.workspace_id IS NOT h.workspace_id OR NEW.generation IS NOT h.generation OR NEW.intent_digest IS NOT h.intent_digest))
      THEN RAISE(ABORT,'immutable disk parent') END;
    SELECT CASE WHEN EXISTS(SELECT 1 FROM output_collection_intents WHERE attempt_id=OLD.attempt_id)
      AND (NEW.offer_json IS NOT OLD.offer_json OR NEW.canonical_json IS NOT OLD.canonical_json
        OR NEW.result_json IS NOT OLD.result_json OR NEW.wrapper_checkpoint_json IS NOT OLD.wrapper_checkpoint_json
        OR NEW.wrapper_high IS NOT OLD.wrapper_high)
      THEN RAISE(ABORT,'immutable output original') END;
    SELECT CASE WHEN EXISTS(SELECT 1 FROM output_delivery_closures WHERE attempt_id=OLD.attempt_id)
      AND (NEW.id IS NOT OLD.id OR NEW.last_seq IS NOT OLD.last_seq OR NEW.supervisor_high IS NOT OLD.supervisor_high
        OR NEW.wrapper_high IS NOT OLD.wrapper_high OR NEW.result_json IS NOT OLD.result_json
        OR NEW.wrapper_checkpoint_json IS NOT OLD.wrapper_checkpoint_json)
      THEN RAISE(ABORT,'closed output delivery') END;
  END;
  CREATE TRIGGER delivery_parent_insert BEFORE INSERT ON accepted_attempts
    WHEN NEW.delivery_bytes!=0 OR NEW.delivery_pending!=0
    BEGIN SELECT RAISE(ABORT,'immutable delivery parent'); END;
  DROP TRIGGER output_source_inserted;
  CREATE TRIGGER output_source_inserted AFTER INSERT ON output_sources BEGIN
    UPDATE accepted_attempts SET source_bytes=NEW.charged_bytes,delivery_pending=1 WHERE attempt_id=NEW.attempt_id;
    UPDATE output_collection_intents SET phase='sourced' WHERE attempt_id=NEW.attempt_id;
  END;
`;
function jsonEqual(left: string, right: string): string {
  const values = (input: string) => `SELECT fullkey,type,atom FROM json_tree(${input})`;
  return `(NOT EXISTS(${values(left)} EXCEPT ${values(right)}) AND NOT EXISTS(${values(right)} EXCEPT ${values(left)}))`;
}
const receiptScope = ['organizationId', 'workspaceId', 'attemptId', 'generation'].map((name, index) =>
  `json_extract(NEW.closure_json,'$.receipt.key.${name}') IS a.${['organization_id', 'workspace_id', 'attempt_id', 'generation'][index]}`).join(' AND ');
export const deliveryGuards = `
  CREATE TRIGGER delivery_insert BEFORE INSERT ON output_delivery_closures BEGIN
    SELECT CASE WHEN typeof(NEW.closure_json)!='text' OR length(CAST(NEW.closure_json AS BLOB)) NOT BETWEEN 1 AND ${OUTPUT_DELIVERY_BYTES}
      THEN RAISE(ABORT,'invalid output delivery bytes') END;
    SELECT CASE WHEN NOT json_valid(NEW.closure_json) THEN RAISE(ABORT,'invalid output delivery JSON') END;
    SELECT CASE WHEN EXISTS(SELECT 1 FROM output_delivery_closures WHERE attempt_id=NEW.attempt_id)
      THEN RAISE(ABORT,'immutable output delivery') END;
    SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM accepted_attempts a JOIN output_sources s USING(attempt_id)
      JOIN output_collection_intents i USING(attempt_id) JOIN reservations r USING(attempt_id) JOIN disk_holds h USING(attempt_id)
      WHERE a.attempt_id=NEW.attempt_id AND i.phase='sourced' AND r.charged=0 AND h.phase='retained'
        AND a.delivery_pending=1 AND a.delivery_bytes=0 AND a.source_bytes=s.charged_bytes AND a.collection_bytes=i.charged_bytes
        AND a.hold_bytes=512 AND h.metadata_bytes=512 AND h.organization_id=a.organization_id AND h.workspace_id=a.workspace_id
        AND h.generation=a.generation AND h.intent_digest=a.intent_digest
        AND json_type(NEW.closure_json)='object' AND (SELECT COUNT(*) FROM json_each(NEW.closure_json))=3
        AND json_type(NEW.closure_json,'$.version')='integer' AND json_extract(NEW.closure_json,'$.version')=1
        AND json_type(NEW.closure_json,'$.receipt')='object' AND (SELECT COUNT(*) FROM json_each(NEW.closure_json,'$.receipt'))=5
        AND json_type(NEW.closure_json,'$.receipt.version')='integer' AND json_extract(NEW.closure_json,'$.receipt.version')=1
        AND json_type(NEW.closure_json,'$.receipt.key')='object' AND (SELECT COUNT(*) FROM json_each(NEW.closure_json,'$.receipt.key'))=4
        AND ${receiptScope}
        AND json_type(NEW.closure_json,'$.receipt.key.generation')='integer'
        AND json_extract(NEW.closure_json,'$.receipt.journalAuthority')=(SELECT authority FROM journal_authority WHERE id=1)
        AND json_extract(NEW.closure_json,'$.receipt.journalAuthority')=json_extract(s.source_json,'$.manifest.binding.journalAuthority')
        AND json_extract(NEW.closure_json,'$.receipt.manifestDigest')=s.manifest_digest
        AND json_extract(NEW.closure_json,'$.receipt.sourceDigest')=s.source_digest
        AND json_type(NEW.closure_json,'$.finalAgentSeq')='integer'
        AND json_extract(NEW.closure_json,'$.finalAgentSeq') BETWEEN 0 AND 9007199254740991
        AND json_extract(NEW.closure_json,'$.finalAgentSeq')=a.last_seq
        AND json_extract(r.reservation_json,'$.status')='released'
        AND ${jsonEqual("json_extract(r.reservation_json,'$.releaseEvidence')", "json_extract(s.source_json,'$.release')")})
      THEN RAISE(ABORT,'invalid output delivery') END;
  END;
  CREATE TRIGGER delivery_inserted AFTER INSERT ON output_delivery_closures BEGIN
    UPDATE accepted_attempts SET delivery_bytes=NEW.charged_bytes,delivery_pending=0 WHERE attempt_id=NEW.attempt_id;
  END;
  CREATE TRIGGER delivery_update BEFORE UPDATE ON output_delivery_closures
    BEGIN SELECT RAISE(ABORT,'immutable output delivery'); END;
  CREATE TRIGGER delivery_delete BEFORE DELETE ON output_delivery_closures
    BEGIN SELECT RAISE(ABORT,'immutable output delivery'); END;
  CREATE TRIGGER delivery_event_insert BEFORE INSERT ON event_spool
    WHEN EXISTS(SELECT 1 FROM output_delivery_closures WHERE attempt_id=NEW.attempt_id)
    BEGIN SELECT RAISE(ABORT,'closed output delivery'); END;
  CREATE TRIGGER delivery_event_update BEFORE UPDATE ON event_spool
    WHEN EXISTS(SELECT 1 FROM output_delivery_closures WHERE attempt_id=OLD.attempt_id OR attempt_id=NEW.attempt_id)
    BEGIN SELECT RAISE(ABORT,'closed output delivery'); END;
`;

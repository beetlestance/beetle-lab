import { OUTPUT_COLLECTION_INTENT_BYTES, OUTPUT_SOURCE_BYTES, OUTPUT_SOURCE_ROW_OVERHEAD } from '../output-source/index.js';

export const outputSourceTables = `
  ALTER TABLE accepted_attempts ADD COLUMN collection_bytes INTEGER NOT NULL DEFAULT 0
    CHECK(typeof(collection_bytes)='integer' AND collection_bytes BETWEEN 0 AND ${OUTPUT_COLLECTION_INTENT_BYTES + OUTPUT_SOURCE_ROW_OVERHEAD});
  ALTER TABLE accepted_attempts ADD COLUMN source_bytes INTEGER NOT NULL DEFAULT 0
    CHECK(typeof(source_bytes)='integer' AND source_bytes BETWEEN 0 AND ${OUTPUT_SOURCE_BYTES + OUTPUT_SOURCE_ROW_OVERHEAD}
      AND spool_bytes+snapshot_bytes+checkpoint_bytes+hold_bytes+collection_bytes+source_bytes<=quota_bytes);
  CREATE TABLE output_collection_intents (
    attempt_id TEXT PRIMARY KEY REFERENCES reservations(attempt_id),
    collection_id TEXT NOT NULL,
    intent_json TEXT NOT NULL CHECK(typeof(intent_json)='text' AND json_valid(intent_json)
      AND length(CAST(intent_json AS BLOB)) BETWEEN 1 AND ${OUTPUT_COLLECTION_INTENT_BYTES}),
    charged_bytes INTEGER NOT NULL CHECK(typeof(charged_bytes)='integer'
      AND charged_bytes=length(CAST(intent_json AS BLOB))+${OUTPUT_SOURCE_ROW_OVERHEAD}
      AND charged_bytes BETWEEN 257 AND ${OUTPUT_COLLECTION_INTENT_BYTES + OUTPUT_SOURCE_ROW_OVERHEAD}),
    phase TEXT NOT NULL CHECK(phase IN ('pending','sourced','failed')),
    created_epoch TEXT NOT NULL CHECK(length(CAST(created_epoch AS BLOB))=36)
  );
  CREATE TABLE output_sources (
    attempt_id TEXT PRIMARY KEY REFERENCES output_collection_intents(attempt_id),
    source_json TEXT NOT NULL CHECK(typeof(source_json)='text' AND json_valid(source_json)
      AND length(CAST(source_json AS BLOB)) BETWEEN 1 AND ${OUTPUT_SOURCE_BYTES}),
    manifest_digest TEXT NOT NULL CHECK(length(manifest_digest)=64 AND manifest_digest NOT GLOB '*[^a-f0-9]*'),
    source_digest TEXT NOT NULL CHECK(length(source_digest)=64 AND source_digest NOT GLOB '*[^a-f0-9]*'),
    charged_bytes INTEGER NOT NULL CHECK(typeof(charged_bytes)='integer'
      AND charged_bytes=length(CAST(source_json AS BLOB))+${OUTPUT_SOURCE_ROW_OVERHEAD}
      AND charged_bytes BETWEEN 257 AND ${OUTPUT_SOURCE_BYTES + OUTPUT_SOURCE_ROW_OVERHEAD})
  );
`;

const exactCharge = (table: string): string => `COALESCE((SELECT charged_bytes FROM ${table} WHERE attempt_id=OLD.attempt_id),0)`;
export const outputParentGuards = `
  DROP TRIGGER disk_parent_update;
  CREATE TRIGGER disk_parent_update BEFORE UPDATE ON accepted_attempts BEGIN
    SELECT CASE WHEN NEW.hold_bytes!=CASE WHEN EXISTS(SELECT 1 FROM disk_holds WHERE attempt_id=OLD.attempt_id) THEN 512 ELSE 0 END
      OR NEW.collection_bytes!=${exactCharge('output_collection_intents')} OR NEW.source_bytes!=${exactCharge('output_sources')}
      OR NEW.hold_bytes+NEW.spool_bytes+NEW.snapshot_bytes+NEW.checkpoint_bytes+NEW.collection_bytes+NEW.source_bytes>NEW.quota_bytes
      THEN RAISE(ABORT,'output source quota') END;
    SELECT CASE WHEN EXISTS(SELECT 1 FROM disk_holds h WHERE h.attempt_id=OLD.attempt_id
      AND (NEW.attempt_id IS NOT OLD.attempt_id OR NEW.organization_id IS NOT h.organization_id
        OR NEW.workspace_id IS NOT h.workspace_id OR NEW.generation IS NOT h.generation OR NEW.intent_digest IS NOT h.intent_digest))
      THEN RAISE(ABORT,'immutable disk parent') END;
    SELECT CASE WHEN EXISTS(SELECT 1 FROM output_collection_intents WHERE attempt_id=OLD.attempt_id)
      AND (NEW.offer_json IS NOT OLD.offer_json OR NEW.canonical_json IS NOT OLD.canonical_json
        OR NEW.result_json IS NOT OLD.result_json OR NEW.wrapper_checkpoint_json IS NOT OLD.wrapper_checkpoint_json
        OR NEW.wrapper_high IS NOT OLD.wrapper_high)
      THEN RAISE(ABORT,'immutable output original') END;
  END;
  CREATE TRIGGER output_parent_insert BEFORE INSERT ON accepted_attempts
    WHEN NEW.collection_bytes!=0 OR NEW.source_bytes!=0
    BEGIN SELECT RAISE(ABORT,'immutable output parent'); END;
`;

import { LIVE_HISTORY_BYTES } from '@beetle/contracts/api';
import { STOPPED_HISTORY_ROW_ALLOWANCE } from './stopped-history-value.js';
import { stoppedHistoryQuotaUsed } from './migration028.js';

export const migration029 = `
CREATE TABLE stopped_delivery_observations (
  attempt_id TEXT PRIMARY KEY REFERENCES output_delivery_closures(attempt_id),
  history_json TEXT NOT NULL CHECK(typeof(history_json)='text' AND json_valid(history_json)
    AND length(CAST(history_json AS BLOB)) BETWEEN 1 AND ${LIVE_HISTORY_BYTES}),
  history_digest TEXT NOT NULL CHECK(typeof(history_digest)='text' AND length(history_digest)=64
    AND history_digest NOT GLOB '*[^a-f0-9]*'),
  charged_bytes INTEGER NOT NULL CHECK(typeof(charged_bytes)='integer'
    AND charged_bytes=length(CAST(history_json AS BLOB))+${STOPPED_HISTORY_ROW_ALLOWANCE})
);
CREATE TRIGGER stopped_delivery_insert BEFORE INSERT ON stopped_delivery_observations BEGIN
  SELECT CASE WHEN agent_settlement_active()=1 OR
    agent_stopped_delivery_insert_allowed(NEW.attempt_id,NEW.history_json,NEW.history_digest,NEW.charged_bytes)!=1 OR NOT EXISTS(
     SELECT 1 FROM accepted_attempts a JOIN output_delivery_closures c USING(attempt_id)
     JOIN output_sources s USING(attempt_id) JOIN reservations r USING(attempt_id)
     WHERE a.attempt_id=NEW.attempt_id AND a.execution_purpose='performance'
       AND a.state='exited' AND a.exit_facts_json IS NOT NULL
       AND json_extract(r.reservation_json,'$.releaseEvidence.launch.epoch')=1
       AND json_extract(r.reservation_json,'$.releaseEvidence.runtime.state')='stopped'
       AND json_extract(c.closure_json,'$.receipt.sourceDigest')=s.source_digest
       AND json_extract(c.closure_json,'$.receipt.manifestDigest')=s.manifest_digest
       AND json_extract(c.closure_json,'$.finalAgentSeq')=a.last_seq
       AND json_extract(s.source_json,'$.manifest.result.engineId')='k6'
       AND json_extract(s.source_json,'$.manifest.result.completeness') IN ('partial','missing')
       AND NOT EXISTS(SELECT 1 FROM json_each(s.source_json,'$.manifest.result.artifacts')
         WHERE json_extract(value,'$.kind') IN ('metric-windows','metric-index'))
       AND lower(json_extract(NEW.history_json,'$.scope.attemptId')) IS lower(a.attempt_id)
       AND lower(json_extract(NEW.history_json,'$.scope.organizationId')) IS lower(a.organization_id)
       AND lower(json_extract(NEW.history_json,'$.scope.workspaceId')) IS lower(a.workspace_id)
       AND json_extract(NEW.history_json,'$.scope.generation') IS a.generation
       AND NEW.charged_bytes+json_extract(s.source_json,'$.manifest.verifiedBytes')
         <=json_extract(r.reservation_json,'$.budget.outputBytes')
       AND ${stoppedHistoryQuotaUsed('a')}+NEW.charged_bytes<=a.quota_bytes)
  THEN RAISE(ABORT,'stopped history requires settled delivery and available custody') END;
END;
CREATE TRIGGER stopped_delivery_quota BEFORE UPDATE ON accepted_attempts
WHEN ${stoppedHistoryQuotaUsed('NEW')}+COALESCE((SELECT charged_bytes FROM stopped_delivery_observations
WHERE attempt_id=OLD.attempt_id),0)>NEW.quota_bytes
BEGIN SELECT RAISE(ABORT,'stopped delivery history quota'); END;
CREATE TRIGGER stopped_delivery_update BEFORE UPDATE ON stopped_delivery_observations
BEGIN SELECT RAISE(ABORT,'immutable stopped delivery history'); END;
CREATE TRIGGER stopped_delivery_delete BEFORE DELETE ON stopped_delivery_observations
WHEN agent_settlement_delete_allowed(OLD.attempt_id,'stopped_delivery_observations')!=1
BEGIN SELECT RAISE(ABORT,'retained stopped delivery history'); END;
PRAGMA user_version=29;
`;

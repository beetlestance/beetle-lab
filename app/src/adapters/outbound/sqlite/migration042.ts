import { LIVE_HISTORY_BYTES } from '@beetle/contracts/api';
import { systemStopProjection } from './migration039.js';

const stoppedSource = `
  s.final_agent_seq>0 AND json_extract(e.snapshot_json,'$.state')='exited'
  AND json_type(e.snapshot_json,'$.exitEvidence')='object'
  AND json_extract(p.canonical_json,'$.result.engineId')='k6'
  AND json_extract(p.canonical_json,'$.result.completeness') IN ('partial','missing')
  AND NOT EXISTS(SELECT 1 FROM json_each(p.canonical_json,'$.result.artifacts')
    WHERE json_extract(value,'$.kind') IN ('metric-windows','metric-index'))`;

const stoppedSourceProjection = systemStopProjection
  .replace(' retained_payload_bytes,', `+coalesce(h.bytes,0) retained_payload_bytes, (${stoppedSource}) history_ready,`)
  .replace(
    ' LEFT JOIN event_cursors',
    ' LEFT JOIN execution_source_stopped_history h ON h.attempt_id=s.attempt_id AND h.source_digest=s.source_digest\n LEFT JOIN event_cursors',
  );

export const migration042 = `
CREATE TABLE execution_source_stopped_history (
  attempt_id TEXT PRIMARY KEY REFERENCES execution_output_sources(attempt_id),
  source_digest TEXT NOT NULL CHECK(length(source_digest)=64 AND source_digest NOT GLOB '*[^0-9a-f]*'),
  canonical_json TEXT NOT NULL CHECK(typeof(canonical_json)='text' AND json_valid(canonical_json)),
  digest TEXT NOT NULL CHECK(length(digest)=64 AND digest NOT GLOB '*[^0-9a-f]*'),
  bytes INTEGER NOT NULL CHECK(typeof(bytes)='integer' AND bytes=length(CAST(canonical_json AS BLOB))
    AND bytes BETWEEN 1 AND ${LIVE_HISTORY_BYTES})
);
DROP VIEW output_finalization_evidence;
${stoppedSourceProjection}
CREATE TRIGGER source_stopped_history_insert BEFORE INSERT ON execution_source_stopped_history BEGIN
 SELECT CASE WHEN backend_settlement_active()=1 OR backend_source_stopped_history_insert(
    NEW.attempt_id,NEW.source_digest,NEW.canonical_json,NEW.digest,NEW.bytes) IS NOT 1
   OR NOT EXISTS(SELECT 1 FROM output_finalization_evidence v
    WHERE v.attempt_id=NEW.attempt_id AND v.source_digest=NEW.source_digest
    AND v.active_attempt_id=NEW.attempt_id AND v.previous_state IN ('queued','dispatching','active','finalizing')
    AND v.header_last_seq=v.final_agent_seq AND v.execution_ready=1 AND v.events_ready=1
    AND v.artifacts_ready=1 AND v.stop_ready=1 AND v.state IN ('errored','cancelled') AND v.history_ready=1
    AND NEW.bytes<=v.maximum_payload_bytes-v.retained_payload_bytes)
   OR EXISTS(SELECT 1 FROM execution_output_finalizations f WHERE f.attempt_id=NEW.attempt_id)
 THEN RAISE(ABORT,'source stopped history requires exact finalized custody') END;
END;
CREATE TRIGGER source_stopped_history_update BEFORE UPDATE ON execution_source_stopped_history
BEGIN SELECT RAISE(ABORT,'immutable source stopped history'); END;
CREATE TRIGGER source_stopped_history_delete BEFORE DELETE ON execution_source_stopped_history
WHEN backend_settlement_delete('execution_source_stopped_history',OLD.attempt_id) IS NOT 1
BEGIN SELECT RAISE(ABORT,'retained source stopped history'); END;
PRAGMA user_version=42;
`;

import { LIVE_HISTORY_BYTES } from '@beetle/contracts/api';
import { absenceOomProjection } from './migration040.js';

export const stoppedHistoryProjection = absenceOomProjection
  .replace(' retained_payload_bytes,', '+coalesce(h.bytes,0) retained_payload_bytes,')
  .replace(
    ' header_last_seq,',
    " header_last_seq, (json_extract(e.snapshot_json,'$.state')='exited' AND json_type(e.snapshot_json,'$.exitEvidence')='object') history_ready,",
  )
  .replace(
    ' LEFT JOIN event_cursors',
    ' LEFT JOIN execution_stopped_history h ON h.attempt_id=s.attempt_id AND h.proof_digest=s.proof_digest\n LEFT JOIN event_cursors',
  );

export const migration041 = `
CREATE TABLE execution_stopped_history (
  attempt_id TEXT PRIMARY KEY REFERENCES execution_output_absences(attempt_id),
  proof_digest TEXT NOT NULL CHECK(length(proof_digest)=64 AND proof_digest NOT GLOB '*[^0-9a-f]*'),
  canonical_json TEXT NOT NULL CHECK(typeof(canonical_json)='text' AND json_valid(canonical_json)),
  digest TEXT NOT NULL CHECK(length(digest)=64 AND digest NOT GLOB '*[^0-9a-f]*'),
  bytes INTEGER NOT NULL CHECK(typeof(bytes)='integer' AND bytes=length(CAST(canonical_json AS BLOB))
    AND bytes BETWEEN 1 AND ${LIVE_HISTORY_BYTES})
);
DROP VIEW output_absence_evidence;
${stoppedHistoryProjection}
CREATE TRIGGER stopped_history_insert BEFORE INSERT ON execution_stopped_history BEGIN
 SELECT CASE WHEN backend_settlement_active()=1 OR backend_stopped_history_insert(
    NEW.attempt_id,NEW.proof_digest,NEW.canonical_json,NEW.digest,NEW.bytes) IS NOT 1
   OR NOT EXISTS(SELECT 1 FROM output_absence_evidence v JOIN execution_output_absences a USING(attempt_id)
    JOIN execution_records e USING(attempt_id)
    WHERE v.attempt_id=NEW.attempt_id AND a.proof_digest=NEW.proof_digest
    AND v.active_attempt_id=NEW.attempt_id AND v.previous_state IN ('queued','dispatching','active','finalizing')
    AND v.execution_ready=1 AND v.events_ready=1 AND v.final_agent_seq>0
    AND json_extract(a.proof_json,'$.admission.state')='released'
    AND json_extract(a.proof_json,'$.admission.disposition')='settled'
    AND json_extract(e.snapshot_json,'$.state')='exited'
    AND json_type(e.snapshot_json,'$.exitEvidence')='object'
    AND NEW.bytes<=v.maximum_payload_bytes-v.retained_payload_bytes)
 THEN RAISE(ABORT,'stopped history requires exact finalized custody') END;
END;
CREATE TRIGGER stopped_history_update BEFORE UPDATE ON execution_stopped_history
BEGIN SELECT RAISE(ABORT,'immutable stopped history'); END;
CREATE TRIGGER stopped_history_delete BEFORE DELETE ON execution_stopped_history
WHEN backend_settlement_delete('execution_stopped_history',OLD.attempt_id) IS NOT 1
BEGIN SELECT RAISE(ABORT,'retained stopped history'); END;
PRAGMA user_version=41;
`;

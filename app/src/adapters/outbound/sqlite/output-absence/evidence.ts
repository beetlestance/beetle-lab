import { finalEventsReady, releasedHeader } from '../output-finalization/facts.js';
/** Point-bound derived facts shared by worker decisions and native receipt authority. */
export const absenceEvidence = `
CREATE VIEW output_absence_evidence AS SELECT e.attempt_id,e.run_id,e.organization_id,e.workspace_id,
 e.intent_digest,e.journal_authority,e.acknowledged_generation generation,s.proof_digest,s.final_agent_seq,
 r.version+1 run_version,r.active_attempt_id,r.state previous_state,a.maximum_payload_bytes,
 json_extract(e.snapshot_json,'$.lastSeq') header_last_seq,
 coalesce(c.retained_bytes,0)+coalesce(length(CAST(p.canonical_json AS BLOB)),0) retained_payload_bytes,
 CASE WHEN r.cancellation_requested=1 THEN 'cancelled' ELSE 'errored' END state,
 'inconclusive' outcome,'pending' validation_status,
 CASE WHEN r.cancellation_requested=1 THEN 'cancelled' ELSE json_extract(s.proof_json,'$.reason') END reason,
 ${releasedHeader}
 AND json_extract(e.snapshot_json,'$.admission.state') IS json_extract(s.proof_json,'$.admission.state') AND json_extract(e.snapshot_json,'$.admission.disposition') IS json_extract(s.proof_json,'$.admission.disposition') AND json_extract(e.snapshot_json,'$.admission.reason') IS json_extract(s.proof_json,'$.admission.reason')
 AND json_extract(e.snapshot_json,'$.lastSeq')=s.final_agent_seq
 AND (r.cancellation_requested=1 OR json_extract(s.proof_json,'$.reason')!='cancelled') execution_ready,
 ${finalEventsReady('s.final_agent_seq')} events_ready
 FROM execution_records e JOIN runs r ON r.id=e.run_id AND r.organization_id=e.organization_id AND r.workspace_id=e.workspace_id
 JOIN attempts t ON t.id=e.attempt_id AND t.run_id=e.run_id AND t.organization_id=e.organization_id AND t.workspace_id=e.workspace_id
 AND t.intent_digest=e.intent_digest AND t.generation=1 AND t.foundation_owned=1 AND t.execution_intent_id=e.attempt_id
 JOIN attempt_output_allocations a ON a.attempt_id=e.attempt_id AND a.run_id=e.run_id
 AND a.organization_id=e.organization_id AND a.workspace_id=e.workspace_id
 JOIN execution_output_absences s ON s.attempt_id=e.attempt_id AND s.run_id=e.run_id
 AND s.organization_id=e.organization_id AND s.workspace_id=e.workspace_id AND s.intent_digest=e.intent_digest
 AND s.journal_authority=e.journal_authority AND s.generation=e.acknowledged_generation
 LEFT JOIN execution_output_payloads p ON p.attempt_id=e.attempt_id AND p.kind='result'
 LEFT JOIN event_cursors c ON c.attempt_id=e.attempt_id AND c.generation=1
 WHERE e.acknowledged_generation=1 AND e.output_pending=1;
`;

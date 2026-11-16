import { finalEventsReady, releasedHeader } from './facts.js';
const header = (path: string) => `json_extract(e.snapshot_json,'$.${path}')`;
const child = (path: string) => `json_extract(p.canonical_json,'$.result.${path}')`;
const wrapperReason = header('exitEvidence.reason');
const childReason = child('execution.reason');
const completed = `${child('execution.status')}='completed'`;
/** One projection owner, shared by the native insertion guard and worker read.
 * All aggregates are correlated point reads, never a grouped history scan.
 */
export const finalizationEvidence = `
CREATE VIEW output_finalization_evidence AS SELECT e.attempt_id,e.run_id,e.organization_id,e.workspace_id,
 e.intent_digest,e.journal_authority,e.acknowledged_generation generation,s.source_digest,s.manifest_digest,s.final_agent_seq,
 r.version+1 run_version,r.active_attempt_id,r.state previous_state,r.cancellation_requested,
 a.maximum_payload_bytes,${header('lastSeq')} header_last_seq,
 coalesce(c.retained_bytes,0)+length(CAST(p.canonical_json AS BLOB))+
  coalesce((SELECT sum(json_extract(value,'$.bytes')) FROM json_each(p.canonical_json,'$.result.artifacts')),0) retained_payload_bytes,
 CASE WHEN r.cancellation_requested=1 THEN 'cancelled'
  WHEN ${header('exitEvidence.oomKilled')}=1 THEN 'errored'
  WHEN json_type(e.snapshot_json,'$.exitEvidence.exitCode') IS NOT 'integer'
   OR json_type(e.snapshot_json,'$.exitEvidence.oomKilled') NOT IN ('true','false')
   OR json_type(e.snapshot_json,'$.exitEvidence.oomKilled') IS NULL
   OR ${wrapperReason}='cancelled' OR ${child('execution.status')}='cancelled'
   OR ${header('cancelRequested')}=1 THEN NULL
  WHEN ${header('exitEvidence.exitCode')}!=0 THEN 'errored'
  WHEN ${wrapperReason} IS NOT NULL AND ${wrapperReason}!='cancelled' THEN 'errored'
  WHEN ${child('execution.status')} IN ('error','lost') AND ${childReason}!='cancelled' THEN 'errored'
  WHEN ${header('exitEvidence.exitCode')}=0 AND ${header('exitEvidence.oomKilled')}=0
   AND ${wrapperReason} IS NULL AND ${completed} THEN 'finished' ELSE NULL END state,
 CASE WHEN r.cancellation_requested=0 AND ${header('exitEvidence.exitCode')}=0
  AND ${header('exitEvidence.oomKilled')}=0 AND ${wrapperReason} IS NULL AND ${completed}
  THEN ${child('outcome')} ELSE 'inconclusive' END outcome,
 CASE WHEN ${completed} THEN 'passed'
  WHEN ${child('execution.status')}='error' AND ${childReason}='invalid_config' THEN 'failed' ELSE 'pending' END validation_status,
 CASE WHEN r.cancellation_requested=1 THEN 'cancelled'
  WHEN ${header('exitEvidence.oomKilled')}=1 THEN 'memory_limit'
  WHEN ${header('exitEvidence.exitCode')}!=0 THEN CASE WHEN ${wrapperReason}!='cancelled' THEN ${wrapperReason} ELSE 'engine_crash' END
  WHEN ${wrapperReason} IS NOT NULL AND ${wrapperReason}!='cancelled' THEN ${wrapperReason}
  WHEN ${child('execution.status')}='lost' THEN 'execution_lost'
  WHEN ${child('execution.status')}='error' AND ${childReason}!='cancelled' THEN ${childReason} ELSE NULL END reason,
 ${releasedHeader}
  AND ${header('admission.state')}='released' AND ${header('admission.disposition')}='settled' execution_ready,
 ${finalEventsReady('s.final_agent_seq')} events_ready,
 (SELECT count(*) FROM execution_output_slots WHERE attempt_id=e.attempt_id)=json_array_length(p.canonical_json,'$.result.artifacts')
  AND NOT EXISTS(SELECT 1 FROM execution_output_slots x WHERE x.attempt_id=e.attempt_id AND (
   json_extract(x.slot_json,'$.p') IS NOT 'published' OR json_extract(x.slot_json,'$.w') IS NOT NULL
   OR json_type(x.slot_json,'$.i') IS NOT 'text' OR length(json_extract(x.slot_json,'$.i'))!=64
   OR json_extract(x.slot_json,'$.i') GLOB '*[^0-9a-f]*'
   OR json_extract(x.slot_json,'$.o') IS NOT json_extract(p.canonical_json,'$.result.artifacts['||x.ordinal||'].bytes'))) artifacts_ready
 FROM execution_records e JOIN runs r ON r.id=e.run_id AND r.organization_id=e.organization_id AND r.workspace_id=e.workspace_id
 JOIN attempts t ON t.id=e.attempt_id AND t.run_id=e.run_id AND t.organization_id=e.organization_id AND t.workspace_id=e.workspace_id
  AND t.intent_digest=e.intent_digest AND t.generation=1 AND t.foundation_owned=1 AND t.execution_intent_id=e.attempt_id
 JOIN attempt_output_allocations a ON a.attempt_id=e.attempt_id AND a.run_id=e.run_id
  AND a.organization_id=e.organization_id AND a.workspace_id=e.workspace_id
 JOIN execution_output_sources s ON s.attempt_id=e.attempt_id AND s.run_id=e.run_id
  AND s.organization_id=e.organization_id AND s.workspace_id=e.workspace_id AND s.intent_digest=e.intent_digest
  AND s.journal_authority=e.journal_authority AND s.generation=e.acknowledged_generation
 JOIN execution_output_payloads p ON p.attempt_id=e.attempt_id AND p.kind='manifest'
  AND json_extract(p.canonical_json,'$.manifestDigest')=s.manifest_digest
 LEFT JOIN event_cursors c ON c.attempt_id=e.attempt_id AND c.generation=1
 WHERE e.acknowledged_generation=1 AND e.output_pending=1;
`;

const proof = (row = 'NEW') => `EXISTS(SELECT 1 FROM execution_output_absences WHERE attempt_id=${row}.attempt_id)`;
const settled = (row = 'NEW') => `EXISTS(SELECT 1 FROM execution_output_absence_finalizations WHERE attempt_id=${row}.attempt_id)`;
const match = ['attempt_id','run_id','organization_id','workspace_id','intent_digest','journal_authority','generation',
  'proof_digest','final_agent_seq','retained_payload_bytes','run_version','state','outcome','validation_status','reason']
  .map(name => `v.${name} IS NEW.${name}`).join(' AND ');
const identity = ['organizationId','workspaceId','attemptId','intentDigest','journalAuthority'].map(field => {
  const columns = { organizationId: 'organization_id', workspaceId: 'workspace_id', attemptId: 'attempt_id',
    intentDigest: 'intent_digest', journalAuthority: 'journal_authority' };
  return `json_extract(NEW.proof_json,'$.${field}') IS NEW.${columns[field as keyof typeof columns]}`;
}).join(' AND ');
const freeze = (table: string, action: string, condition: string) => `CREATE TRIGGER absence_${table}_${action.toLowerCase()}
 BEFORE ${action} ON ${table} WHEN ${condition} BEGIN SELECT RAISE(ABORT,'closed absence custody'); END;`;
export const absenceGuards = `
CREATE TRIGGER absence_proof_insert BEFORE INSERT ON execution_output_absences BEGIN
 SELECT CASE WHEN ${proof()} OR EXISTS(SELECT 1 FROM execution_output_sources WHERE attempt_id=NEW.attempt_id)
 OR EXISTS(SELECT 1 FROM execution_output_finalizations WHERE attempt_id=NEW.attempt_id)
 OR EXISTS(SELECT 1 FROM execution_output_slots WHERE attempt_id=NEW.attempt_id)
 OR EXISTS(SELECT 1 FROM execution_output_payloads WHERE attempt_id=NEW.attempt_id AND kind!='result')
 THEN RAISE(ABORT,'absence excludes source custody') END;
 SELECT CASE WHEN output_absence_digest(NEW.proof_json) IS NOT NEW.proof_digest
 OR NOT (${identity}) OR json_extract(NEW.proof_json,'$.generation') IS NOT NEW.generation
 OR json_extract(NEW.proof_json,'$.finalAgentSeq') IS NOT NEW.final_agent_seq
 OR coalesce((SELECT max(seq) FROM run_events WHERE attempt_id=NEW.attempt_id),0)>NEW.final_agent_seq
 THEN RAISE(ABORT,'exact canonical absence required') END; END;
CREATE TRIGGER absence_proof_update BEFORE UPDATE ON execution_output_absences BEGIN SELECT RAISE(ABORT,'immutable absence'); END;
CREATE TRIGGER absence_proof_delete BEFORE DELETE ON execution_output_absences BEGIN SELECT RAISE(ABORT,'retained absence'); END;
CREATE TRIGGER absence_receipt_insert BEFORE INSERT ON execution_output_absence_finalizations BEGIN
 SELECT CASE WHEN ${settled()} OR EXISTS(SELECT 1 FROM execution_output_finalizations WHERE attempt_id=NEW.attempt_id)
 THEN RAISE(ABORT,'retained absence receipt') END;
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM output_absence_evidence v WHERE v.attempt_id=NEW.attempt_id AND ${match}
 AND v.active_attempt_id=NEW.attempt_id AND v.previous_state IN ('queued','dispatching','active','finalizing')
 AND v.header_last_seq=v.final_agent_seq AND v.execution_ready=1 AND v.events_ready=1
 AND v.retained_payload_bytes<=v.maximum_payload_bytes AND v.maximum_payload_bytes-NEW.retained_payload_bytes=NEW.refunded_bytes
 AND (SELECT charged_bytes FROM installation_storage_usage WHERE id=1)>=NEW.refunded_bytes)
 THEN RAISE(ABORT,'absence requires exact settled custody') END; END;
CREATE TRIGGER absence_receipt_apply AFTER INSERT ON execution_output_absence_finalizations BEGIN
 UPDATE installation_storage_usage SET charged_bytes=charged_bytes-NEW.refunded_bytes WHERE id=1;
 UPDATE runs SET version=NEW.run_version,state=NEW.state,outcome=NEW.outcome,
 validation_status=NEW.validation_status,reason=NEW.reason WHERE id=NEW.run_id;
 UPDATE execution_records SET event_pending=0 WHERE attempt_id=NEW.attempt_id; END;
CREATE TRIGGER absence_receipt_update BEFORE UPDATE ON execution_output_absence_finalizations BEGIN SELECT RAISE(ABORT,'immutable absence receipt'); END;
CREATE TRIGGER absence_receipt_delete BEFORE DELETE ON execution_output_absence_finalizations BEGIN SELECT RAISE(ABORT,'retained absence receipt'); END;
DROP TRIGGER execution_event_pending_retained;
CREATE TRIGGER execution_event_pending_retained BEFORE UPDATE OF event_pending ON execution_records
 WHEN NEW.event_pending IS NOT OLD.event_pending AND NOT (OLD.event_pending=1 AND NEW.event_pending=0 AND
 (EXISTS(SELECT 1 FROM execution_output_finalizations WHERE attempt_id=NEW.attempt_id) OR ${settled()}))
 BEGIN SELECT RAISE(ABORT,'event closure requires finalization authority'); END;
CREATE TRIGGER absence_execution_update BEFORE UPDATE ON execution_records WHEN ${settled()} AND (
 NEW.snapshot_json IS NOT OLD.snapshot_json OR NEW.result_observed IS NOT OLD.result_observed
 OR NEW.journal_authority IS NOT OLD.journal_authority OR NEW.execution_charged IS NOT OLD.execution_charged)
 BEGIN SELECT RAISE(ABORT,'finalized absence evidence'); END;
CREATE TRIGGER absence_run_update BEFORE UPDATE ON runs WHEN EXISTS(
 SELECT 1 FROM execution_output_absence_finalizations f WHERE f.run_id=OLD.id AND (
 NEW.active_attempt_id IS NOT f.attempt_id OR NEW.version IS NOT f.run_version OR NEW.state IS NOT f.state
 OR NEW.outcome IS NOT f.outcome OR NEW.validation_status IS NOT f.validation_status OR NEW.reason IS NOT f.reason
 OR NEW.cancellation_requested IS NOT OLD.cancellation_requested)) BEGIN SELECT RAISE(ABORT,'immutable absence projection'); END;
CREATE TRIGGER absence_terminal_run BEFORE UPDATE ON runs WHEN NEW.state IN ('finished','cancelled','errored')
 AND EXISTS(SELECT 1 FROM execution_output_absences WHERE run_id=NEW.id AND attempt_id=NEW.active_attempt_id)
 AND NOT EXISTS(SELECT 1 FROM execution_output_absence_finalizations WHERE run_id=NEW.id AND attempt_id=NEW.active_attempt_id
 AND run_version=NEW.version AND state=NEW.state AND outcome=NEW.outcome AND validation_status=NEW.validation_status AND reason IS NEW.reason)
 BEGIN SELECT RAISE(ABORT,'absence terminal requires receipt'); END;
CREATE TRIGGER absence_event_end BEFORE INSERT ON run_events WHEN EXISTS(
 SELECT 1 FROM execution_output_absences WHERE attempt_id=NEW.attempt_id AND NEW.seq>final_agent_seq)
 BEGIN SELECT RAISE(ABORT,'absence event end'); END;
${freeze('execution_output_sources', 'INSERT', proof())}
${freeze('execution_output_finalizations', 'INSERT', proof())}
${freeze('execution_output_slots', 'INSERT', proof())}
${freeze('execution_output_slots', 'UPDATE', proof())}
${freeze('execution_output_payloads', 'INSERT', `${settled()} OR (NEW.kind='manifest' AND ${proof()})`)}
${freeze('execution_output_payloads', 'UPDATE', `${settled()} OR (NEW.kind='manifest' AND ${proof()})`)}
${freeze('run_events', 'INSERT', settled())}
${freeze('event_cursors', 'INSERT', settled())}
${freeze('event_cursors', 'UPDATE', settled())}
`;

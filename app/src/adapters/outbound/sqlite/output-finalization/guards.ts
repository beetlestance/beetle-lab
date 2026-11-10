const match = ['attempt_id','run_id','organization_id','workspace_id','intent_digest','journal_authority','generation',
  'source_digest','manifest_digest','final_agent_seq','retained_payload_bytes','run_version','state','outcome','validation_status','reason']
  .map(name => `v.${name} IS NEW.${name}`).join(' AND ');
const finalized = (row = 'NEW') => `EXISTS(SELECT 1 FROM execution_output_finalizations WHERE attempt_id=${row}.attempt_id)`;
/** The receipt is the sole credit authority; no mutable allocation or applied flag. */
export const finalizationGuards = `
CREATE TRIGGER finalization_insert BEFORE INSERT ON execution_output_finalizations BEGIN
 SELECT CASE WHEN ${finalized()} THEN RAISE(ABORT,'retained output finalization') END;
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM output_finalization_evidence v WHERE v.attempt_id=NEW.attempt_id AND ${match}
  AND v.active_attempt_id=NEW.attempt_id AND v.previous_state IN ('queued','dispatching','active','finalizing')
  AND v.execution_ready=1 AND v.events_ready=1 AND v.artifacts_ready=1
  AND v.maximum_payload_bytes-NEW.retained_payload_bytes=NEW.refunded_bytes
  AND (SELECT charged_bytes FROM installation_storage_usage WHERE id=1)>=NEW.refunded_bytes)
 THEN RAISE(ABORT,'finalization requires exact settled custody') END; END;
CREATE TRIGGER finalization_apply AFTER INSERT ON execution_output_finalizations BEGIN
 UPDATE installation_storage_usage SET charged_bytes=charged_bytes-NEW.refunded_bytes WHERE id=1;
 UPDATE runs SET version=NEW.run_version,state=NEW.state,outcome=NEW.outcome,
  validation_status=NEW.validation_status,reason=NEW.reason WHERE id=NEW.run_id;
 UPDATE execution_records SET event_pending=0 WHERE attempt_id=NEW.attempt_id;
END;
CREATE TRIGGER finalization_immutable BEFORE UPDATE ON execution_output_finalizations
 BEGIN SELECT RAISE(ABORT,'immutable output finalization'); END;
CREATE TRIGGER finalization_retained BEFORE DELETE ON execution_output_finalizations
 BEGIN SELECT RAISE(ABORT,'retained output finalization'); END;
DROP TRIGGER execution_event_pending_retained;
CREATE TRIGGER execution_event_pending_retained BEFORE UPDATE OF event_pending ON execution_records
 WHEN NEW.event_pending IS NOT OLD.event_pending AND NOT (OLD.event_pending=1 AND NEW.event_pending=0 AND ${finalized()})
 BEGIN SELECT RAISE(ABORT,'event closure requires finalization authority'); END;
CREATE TRIGGER finalized_execution BEFORE UPDATE ON execution_records WHEN ${finalized()} AND (
 NEW.snapshot_json IS NOT OLD.snapshot_json OR NEW.result_observed IS NOT OLD.result_observed
 OR NEW.journal_authority IS NOT OLD.journal_authority OR NEW.execution_charged IS NOT OLD.execution_charged)
 BEGIN SELECT RAISE(ABORT,'finalized execution evidence'); END;
CREATE TRIGGER finalization_run BEFORE UPDATE ON runs WHEN EXISTS(
 SELECT 1 FROM execution_output_finalizations f WHERE f.run_id=OLD.id AND (
 NEW.active_attempt_id IS NOT f.attempt_id OR NEW.version IS NOT f.run_version OR NEW.state IS NOT f.state
 OR NEW.outcome IS NOT f.outcome OR NEW.validation_status IS NOT f.validation_status OR NEW.reason IS NOT f.reason
 OR NEW.cancellation_requested IS NOT OLD.cancellation_requested))
 BEGIN SELECT RAISE(ABORT,'immutable terminal projection'); END;
CREATE TRIGGER source_terminal_run BEFORE UPDATE ON runs WHEN NEW.state IN ('finished','cancelled','errored')
 AND EXISTS(SELECT 1 FROM execution_output_sources WHERE run_id=NEW.id AND attempt_id=NEW.active_attempt_id)
 AND NOT EXISTS(SELECT 1 FROM execution_output_finalizations WHERE run_id=NEW.id AND attempt_id=NEW.active_attempt_id
  AND run_version=NEW.version AND state=NEW.state AND outcome=NEW.outcome AND validation_status=NEW.validation_status AND reason IS NEW.reason)
 BEGIN SELECT RAISE(ABORT,'source terminal projection requires receipt'); END;
CREATE TRIGGER finalized_event_insert BEFORE INSERT ON run_events WHEN ${finalized()}
 BEGIN SELECT RAISE(ABORT,'finalized event custody'); END;
CREATE TRIGGER finalized_cursor_insert BEFORE INSERT ON event_cursors WHEN ${finalized()}
 BEGIN SELECT RAISE(ABORT,'finalized event custody'); END;
CREATE TRIGGER finalized_cursor_update BEFORE UPDATE ON event_cursors WHEN ${finalized()}
 BEGIN SELECT RAISE(ABORT,'finalized event custody'); END;
CREATE TRIGGER finalized_slot_insert BEFORE INSERT ON execution_output_slots WHEN ${finalized()}
 BEGIN SELECT RAISE(ABORT,'finalized output custody'); END;
CREATE TRIGGER finalized_slot_update BEFORE UPDATE ON execution_output_slots WHEN ${finalized()}
 BEGIN SELECT RAISE(ABORT,'finalized output custody'); END;
CREATE TRIGGER finalized_payload_update BEFORE UPDATE ON execution_output_payloads WHEN ${finalized()}
 BEGIN SELECT RAISE(ABORT,'finalized output custody'); END;
`;

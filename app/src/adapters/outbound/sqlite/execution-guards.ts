/** Enqueue identity, monotonic custody and matched remote evidence fences. */
export const executionGuards = `
CREATE TRIGGER attempts_foundation_insert BEFORE INSERT ON attempts WHEN NEW.foundation_owned!=1 OR NEW.execution_intent_id IS NOT NULL
 BEGIN SELECT RAISE(ABORT,'new attempt requires owned foundation'); END;
CREATE TRIGGER attempts_foundation_immutable BEFORE UPDATE OF foundation_owned ON attempts
 BEGIN SELECT RAISE(ABORT,'immutable foundation'); END;
CREATE TRIGGER attempts_summary_marker BEFORE UPDATE OF execution_intent_id ON attempts
 WHEN NEW.execution_intent_id IS NOT OLD.execution_intent_id AND (OLD.execution_intent_id IS NOT NULL OR
 NEW.execution_intent_id IS NOT NEW.id OR NOT EXISTS(SELECT 1 FROM execution_intents WHERE attempt_id=NEW.id))
 BEGIN SELECT RAISE(ABORT,'owned summary marker'); END;
CREATE TRIGGER outbox_summary_marker BEFORE UPDATE OF execution_intent_id ON dispatch_outbox
 WHEN NEW.execution_intent_id IS NOT OLD.execution_intent_id AND (OLD.execution_intent_id IS NOT NULL OR
 NEW.execution_intent_id IS NOT NEW.attempt_id OR NOT EXISTS(SELECT 1 FROM execution_intents WHERE attempt_id=NEW.attempt_id))
 BEGIN SELECT RAISE(ABORT,'owned summary marker'); END;
CREATE TRIGGER execution_intent_insert BEFORE INSERT ON execution_intents BEGIN
 SELECT CASE WHEN EXISTS(SELECT 1 FROM execution_intents WHERE attempt_id=NEW.attempt_id OR queue_order=NEW.queue_order)
 THEN RAISE(ABORT,'retained execution intent') END;
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM attempts a JOIN runs r ON r.id=a.run_id
 WHERE a.id=NEW.attempt_id AND a.foundation_owned=1 AND a.generation IS NULL AND a.execution_intent_id IS NULL
 AND NOT EXISTS(SELECT 1 FROM dispatch_outbox WHERE attempt_id=a.id)
 AND NEW.profile_alias IS json_extract(r.snapshot_json,'$.engine.profileId')
 AND NEW.cpu_millis IS json_extract(a.offer_json,'$.budget.cpuMillis')
 AND NEW.memory_bytes IS json_extract(a.offer_json,'$.budget.memoryBytes') AND NEW.pids IS json_extract(a.offer_json,'$.budget.pids')
 AND NEW.timeout_ms IS json_extract(a.offer_json,'$.budget.timeoutMs') AND NEW.output_bytes IS json_extract(a.offer_json,'$.budget.outputBytes')
 AND NEW.mode IS json_extract(a.offer_json,'$.executionPolicy.mode') AND NEW.prefer_idle IS json_extract(a.offer_json,'$.executionPolicy.preferIdle')
 AND NEW.input_bytes=(SELECT coalesce(sum(json_extract(value,'$.bytes')),0) FROM json_each(a.offer_json,'$.inputs'))
 AND NEW.secret_bytes=min(coalesce(json_array_length(a.offer_json,'$.secretReferences'),0)*65536,1048576)
 AND NEW.offer_bytes=length(CAST(a.offer_json AS BLOB))) THEN RAISE(ABORT,'unowned execution summary') END; END;
CREATE TRIGGER execution_intent_marker AFTER INSERT ON execution_intents BEGIN
 UPDATE attempts SET execution_intent_id=NEW.attempt_id WHERE id=NEW.attempt_id; END;
CREATE TRIGGER execution_intent_immutable BEFORE UPDATE ON execution_intents BEGIN SELECT RAISE(ABORT,'immutable execution intent'); END;
CREATE TRIGGER execution_intent_retained BEFORE DELETE ON execution_intents BEGIN SELECT RAISE(ABORT,'retained execution intent'); END;
CREATE TRIGGER outbox_requires_summary BEFORE INSERT ON dispatch_outbox
 WHEN NEW.possible_delivery!=0 OR NEW.execution_intent_id IS NOT NULL OR
 NOT EXISTS(SELECT 1 FROM execution_intents WHERE attempt_id=NEW.attempt_id AND intent_digest=NEW.intent_digest)
 BEGIN SELECT RAISE(ABORT,'dispatch requires owned summary'); END;
CREATE TRIGGER outbox_owned_summary AFTER INSERT ON dispatch_outbox BEGIN
 UPDATE dispatch_outbox SET execution_intent_id=NEW.attempt_id WHERE attempt_id=NEW.attempt_id; END;
CREATE TRIGGER outbox_requires_reservation BEFORE UPDATE OF possible_delivery ON dispatch_outbox WHEN NEW.possible_delivery=1
 AND NOT EXISTS(SELECT 1 FROM execution_records e JOIN attempt_output_allocations o ON o.attempt_id=e.attempt_id
 WHERE e.attempt_id=NEW.attempt_id AND e.intent_digest=NEW.intent_digest AND e.execution_charged=1
 AND e.delivery_attempt_id=NEW.attempt_id AND e.snapshot_json IS NULL)
 BEGIN SELECT RAISE(ABORT,'delivery requires owned reservations'); END;
CREATE TRIGGER execution_record_insert BEFORE INSERT ON execution_records BEGIN
 SELECT CASE WHEN EXISTS(SELECT 1 FROM execution_records WHERE attempt_id=NEW.attempt_id)
 THEN RAISE(ABORT,'retained execution record') END;
 SELECT CASE WHEN NEW.execution_charged!=1 OR NEW.snapshot_json IS NOT NULL OR NEW.acknowledged_generation IS NOT NULL
 OR NEW.delivery_attempt_id IS NOT NEW.attempt_id OR
 NOT EXISTS(SELECT 1 FROM dispatch_outbox WHERE attempt_id=NEW.attempt_id AND possible_delivery=0 AND execution_intent_id=NEW.attempt_id)
 THEN RAISE(ABORT,'invalid initial execution record') END;
 SELECT CASE WHEN (SELECT count(*) FROM execution_records INDEXED BY execution_charged WHERE execution_charged=1)>=64
 THEN RAISE(ABORT,'execution ownership limit') END; END;
CREATE TRIGGER execution_record_identity BEFORE UPDATE ON execution_records
 WHEN NEW.attempt_id IS NOT OLD.attempt_id OR NEW.queue_order IS NOT OLD.queue_order OR NEW.run_id IS NOT OLD.run_id
 OR NEW.organization_id IS NOT OLD.organization_id OR NEW.workspace_id IS NOT OLD.workspace_id OR NEW.intent_digest IS NOT OLD.intent_digest
 OR NEW.output_attempt_id IS NOT OLD.output_attempt_id OR NEW.delivery_possible IS NOT OLD.delivery_possible
 OR (OLD.execution_charged=0 AND NEW.execution_charged!=0)
 OR (OLD.acknowledged_generation IS NOT NULL AND NEW.acknowledged_generation IS NOT OLD.acknowledged_generation)
 OR (OLD.delivery_attempt_id IS NULL AND NEW.delivery_attempt_id IS NOT NULL)
 BEGIN SELECT RAISE(ABORT,'immutable execution ownership'); END;
CREATE TRIGGER execution_first_ack BEFORE UPDATE ON execution_records
 WHEN ((OLD.snapshot_json IS NULL AND NEW.snapshot_json IS NOT NULL) OR
 (OLD.acknowledged_generation IS NULL AND NEW.acknowledged_generation IS NOT NULL) OR
 (OLD.delivery_attempt_id IS NOT NULL AND NEW.delivery_attempt_id IS NULL))
 AND NOT EXISTS(SELECT 1 FROM dispatch_outbox WHERE attempt_id=OLD.attempt_id AND intent_digest=OLD.intent_digest
 AND execution_intent_id=OLD.attempt_id AND possible_delivery=1 AND first_delivery_at IS NOT NULL)
 BEGIN SELECT RAISE(ABORT,'ack requires prior possible delivery'); END;
CREATE TRIGGER execution_snapshot BEFORE UPDATE ON execution_records WHEN NEW.snapshot_json IS NOT NULL BEGIN
 SELECT CASE WHEN json_extract(NEW.snapshot_json,'$.protocolVersion') IS NOT '1.0'
 OR json_extract(NEW.snapshot_json,'$.attemptId') IS NOT NEW.attempt_id
 OR json_extract(NEW.snapshot_json,'$.organizationId') IS NOT NEW.organization_id
 OR json_extract(NEW.snapshot_json,'$.workspaceId') IS NOT NEW.workspace_id
 OR json_extract(NEW.snapshot_json,'$.intentDigest') IS NOT NEW.intent_digest
 OR json_extract(NEW.snapshot_json,'$.generation') IS NOT 1 OR NEW.acknowledged_generation IS NOT 1
 OR json_type(NEW.snapshot_json,'$.lastSeq') IS NOT 'integer'
 OR json_extract(NEW.snapshot_json,'$.lastSeq') NOT BETWEEN 0 AND 9007199254740991
 OR json_type(NEW.snapshot_json,'$.retainedStartSeq') IS NOT 'integer'
 OR json_extract(NEW.snapshot_json,'$.retainedStartSeq') NOT BETWEEN 0 AND 9007199254740991
 OR json_extract(NEW.snapshot_json,'$.state') NOT IN ('offered','admitted','preparing','running','stopping','collecting','exited','lost')
 OR json_type(NEW.snapshot_json,'$.state') IS NOT 'text'
 OR json_type(NEW.snapshot_json,'$.cancelRequested') NOT IN ('true','false')
 OR json_type(NEW.snapshot_json,'$.cancelRequested') IS NULL
 THEN RAISE(ABORT,'snapshot identity or bounds') END;
 SELECT CASE WHEN json_type(NEW.snapshot_json,'$.result') IS NOT NULL AND (
 json_extract(NEW.snapshot_json,'$.result.attemptId') IS NOT NEW.attempt_id OR
 json_extract(NEW.snapshot_json,'$.result.organizationId') IS NOT NEW.organization_id OR
 json_extract(NEW.snapshot_json,'$.result.workspaceId') IS NOT NEW.workspace_id OR
 json_extract(NEW.snapshot_json,'$.result.generation') IS NOT 1)
 THEN RAISE(ABORT,'result identity') END; END;
CREATE TRIGGER execution_release BEFORE UPDATE ON execution_records
 WHEN NEW.execution_charged=0 AND (
 (json_extract(NEW.snapshot_json,'$.admission.state') IS 'released' AND
 json_extract(NEW.snapshot_json,'$.admission.disposition') IN ('never_started','settled')) OR
 (json_extract(NEW.snapshot_json,'$.admission.state') IS 'rejected' AND
 json_extract(NEW.snapshot_json,'$.admission.reason') IN ('cancelled','staging_policy','unsupported_capability','unapproved_profile',
 'below_manifest_minimum','per_run_ceiling','timeout_ceiling','impossible_request','controls_unavailable'))) IS NOT 1
 BEGIN SELECT RAISE(ABORT,'execution release requires final admission'); END;
CREATE TRIGGER execution_final_admission_immutable BEFORE UPDATE ON execution_records
 WHEN json_extract(OLD.snapshot_json,'$.admission.state') IN ('released','rejected') AND (
 json_extract(NEW.snapshot_json,'$.admission.state') IS NOT json_extract(OLD.snapshot_json,'$.admission.state') OR
 json_extract(NEW.snapshot_json,'$.admission.reason') IS NOT json_extract(OLD.snapshot_json,'$.admission.reason') OR
 json_extract(NEW.snapshot_json,'$.admission.disposition') IS NOT json_extract(OLD.snapshot_json,'$.admission.disposition'))
 BEGIN SELECT RAISE(ABORT,'immutable final admission'); END;
CREATE TRIGGER execution_record_retained BEFORE DELETE ON execution_records BEGIN SELECT RAISE(ABORT,'retained execution record'); END;
CREATE TRIGGER attempts_owned_ack BEFORE UPDATE OF generation ON attempts WHEN NEW.foundation_owned=1 AND NEW.generation IS NOT NULL
 AND (NEW.generation IS NOT 1 OR NOT EXISTS(SELECT 1 FROM execution_records WHERE attempt_id=NEW.id
 AND acknowledged_generation=1 AND snapshot_json IS NOT NULL))
 BEGIN SELECT RAISE(ABORT,'ack requires matched snapshot'); END;
CREATE TRIGGER attempts_retain_untracked BEFORE DELETE ON attempts
 WHEN OLD.execution_intent_id IS NULL AND (OLD.generation IS NOT NULL OR
 EXISTS(SELECT 1 FROM dispatch_outbox WHERE attempt_id=OLD.id AND possible_delivery=1))
 BEGIN SELECT RAISE(ABORT,'retained untracked execution ownership'); END;
CREATE TRIGGER outbox_retain_untracked BEFORE DELETE ON dispatch_outbox
 WHEN OLD.execution_intent_id IS NULL AND (OLD.possible_delivery=1 OR
 EXISTS(SELECT 1 FROM attempts WHERE id=OLD.attempt_id AND generation IS NOT NULL))
 BEGIN SELECT RAISE(ABORT,'retained untracked delivery ownership'); END;
CREATE TRIGGER outbox_matched_ack BEFORE DELETE ON dispatch_outbox WHEN OLD.possible_delivery=1 AND OLD.execution_intent_id IS NOT NULL
 AND NOT EXISTS(SELECT 1 FROM execution_records e JOIN attempts a ON a.id=e.attempt_id
 WHERE e.attempt_id=OLD.attempt_id AND e.acknowledged_generation=1 AND e.snapshot_json IS NOT NULL
 AND e.delivery_attempt_id IS NULL AND a.generation=1)
 BEGIN SELECT RAISE(ABORT,'outbox requires matched acknowledgment'); END;
`;

import { cleanupControl } from '../cleanup-control/index.js';
import { namespaceCaps } from '../staging-namespace/index.js';
/**
 * Reconciled task directory facts after a renumbered installed root (decision 030). The column lives
 * inside the frozen task-namespace row budget, so the version 1 cleanup-control reserve is unchanged.
 * The anchor and its identity stay immutable. A reconciliation may be written or replaced only while
 * the attempt has a matching retirement intent and no cleanup plan, progress or receipt: facts
 * observed before reconciliation never become removal authority for newly observed files.
 * Cleanup plans created afterwards match the reconciled facts instead of the anchor's.
 */
export const migration027 = `
ALTER TABLE task_staging_namespaces ADD COLUMN reconciliation_json TEXT
 CHECK(reconciliation_json IS NULL OR (typeof(reconciliation_json)='text'
   AND length(CAST(intent_json AS BLOB))+length(CAST(anchor_json AS BLOB))+length(CAST(reconciliation_json AS BLOB))+${namespaceCaps.taskRowAllowance}<=${namespaceCaps.task}
   AND task_reconciliation_valid(reconciliation_json,anchor_json,intent_json)=1));
CREATE TRIGGER task_reconciliation_guard BEFORE UPDATE OF reconciliation_json ON task_staging_namespaces
 WHEN NEW.reconciliation_json IS NOT OLD.reconciliation_json BEGIN
 SELECT CASE WHEN OLD.state!='prepared' OR NEW.reconciliation_json IS NULL
   OR EXISTS(SELECT 1 FROM output_cleanup_plans WHERE attempt_id=OLD.attempt_id)
   OR EXISTS(SELECT 1 FROM output_cleanup_progress WHERE attempt_id=OLD.attempt_id)
   OR EXISTS(SELECT 1 FROM output_cleanup_receipts WHERE attempt_id=OLD.attempt_id)
   OR NOT EXISTS(SELECT 1 FROM output_retirement_intents r JOIN installed_staging_namespace n ON n.namespace_identity=r.namespace_identity
     WHERE r.attempt_id=OLD.attempt_id AND n.state='bound' AND r.namespace_identity=OLD.namespace_identity
     AND r.task_namespace_identity=OLD.task_namespace_identity
     AND r.request_digest=json_extract(NEW.reconciliation_json,'$.retirementRequestDigest'))
   THEN RAISE(ABORT,'invalid task reconciliation') END;
END;
DROP TRIGGER cleanup_plan_initial;
CREATE TRIGGER cleanup_plan_initial BEFORE INSERT ON output_cleanup_plans BEGIN
 SELECT CASE WHEN EXISTS(SELECT 1 FROM output_cleanup_plans WHERE attempt_id=NEW.attempt_id)
 OR NOT EXISTS(SELECT 1 FROM accepted_attempts a
 JOIN output_retirement_intents r ON r.attempt_id=a.attempt_id
 JOIN task_staging_namespaces t ON t.attempt_id=a.attempt_id
 JOIN installed_staging_namespace n ON n.namespace_identity=r.namespace_identity
 JOIN reservations v ON v.attempt_id=a.attempt_id
 WHERE a.attempt_id=NEW.attempt_id AND a.execution_purpose='performance'
 AND a.cleanup_control_version=1 AND a.cleanup_control_bytes=${cleanupControl.reservedBytes}
 AND a.organization_id=json_extract(NEW.plan_json,'$.original.organizationId')
 AND a.workspace_id=json_extract(NEW.plan_json,'$.original.workspaceId')
 AND a.generation=json_extract(NEW.plan_json,'$.original.generation')
 AND a.intent_digest=json_extract(NEW.plan_json,'$.original.intentDigest')
 AND a.staging_namespace_identity=r.namespace_identity AND n.state='bound'
 AND t.state='prepared' AND t.namespace_identity=r.namespace_identity
 AND t.task_namespace_identity=r.task_namespace_identity
 AND v.charged=0 AND json_extract(v.reservation_json,'$.status')='released'
 AND a.last_seq=json_extract(r.intent_json,'$.request.closure.finalAgentSeq') AND a.acknowledged_seq>=a.last_seq
 AND json_extract(r.intent_json,'$.request.journalAuthority')=(SELECT authority FROM journal_authority WHERE id=1)
 AND cleanup_plan_matches_reconciled(NEW.plan_json,r.intent_json,t.intent_json,t.anchor_json,t.reconciliation_json)=1)
 THEN RAISE(ABORT,'invalid cleanup plan original') END;
END;
PRAGMA user_version=27;
`;

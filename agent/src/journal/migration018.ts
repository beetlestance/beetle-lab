import { cleanupControl } from '../cleanup-control/index.js';
/** Immutable bounded plan metadata; no native effects or accounting release. */
export const migration018 = `
CREATE TABLE output_cleanup_plans (
 attempt_id TEXT PRIMARY KEY REFERENCES output_retirement_intents(attempt_id),
 plan_identity TEXT NOT NULL UNIQUE CHECK(typeof(plan_identity)='text' AND length(plan_identity)=64),
 plan_json TEXT NOT NULL CHECK(typeof(plan_json)='text' AND length(CAST(plan_json AS BLOB))<=${cleanupControl.planBytes}
   AND cleanup_plan_identity(plan_json) IS NOT NULL AND plan_identity=cleanup_plan_identity(plan_json)),
 encoded_bytes INTEGER NOT NULL CHECK(typeof(encoded_bytes)='integer' AND encoded_bytes=length(CAST(plan_json AS BLOB))),
 charged_bytes INTEGER NOT NULL CHECK(typeof(charged_bytes)='integer' AND charged_bytes=encoded_bytes+512
   AND charged_bytes<=${cleanupControl.planBytes + 512}),
 CHECK(attempt_id=json_extract(plan_json,'$.original.attemptId'))
);
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
 AND cleanup_plan_matches(NEW.plan_json,r.intent_json,t.intent_json,t.anchor_json)=1)
 THEN RAISE(ABORT,'invalid cleanup plan original') END;
END;
CREATE TRIGGER cleanup_plan_immutable BEFORE UPDATE ON output_cleanup_plans BEGIN SELECT RAISE(ABORT,'immutable cleanup plan'); END;
CREATE TRIGGER cleanup_plan_retained BEFORE DELETE ON output_cleanup_plans BEGIN SELECT RAISE(ABORT,'retained cleanup plan'); END;
PRAGMA user_version=18;
`;

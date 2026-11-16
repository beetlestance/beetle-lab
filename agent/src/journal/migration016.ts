import { cleanupControl } from '../cleanup-control/index.js';
import { namespaceCaps } from '../staging-namespace/index.js';
/** No observations or capacity are invented for old admitted originals. */
export const migration016 = `
CREATE TABLE installed_staging_namespace (
 id INTEGER PRIMARY KEY CHECK(id=1), state TEXT NOT NULL CHECK(state IN ('preparing','bound')),
 namespace_id TEXT NOT NULL UNIQUE, namespace_identity TEXT UNIQUE,
 intent_json TEXT NOT NULL CHECK(length(CAST(intent_json AS BLOB))<=${namespaceCaps.intent} AND staging_namespace_intent_valid(intent_json)=1),
 anchor_json TEXT CHECK(anchor_json IS NULL OR (length(CAST(anchor_json AS BLOB))<=${namespaceCaps.anchor} AND staging_namespace_anchor_valid(anchor_json,intent_json)=1)),
 CHECK(namespace_id=json_extract(intent_json,'$.namespaceId')),
 CHECK((state='preparing' AND anchor_json IS NULL AND namespace_identity IS NULL) OR
   (state='bound' AND anchor_json IS NOT NULL AND namespace_identity=json_extract(anchor_json,'$.namespaceIdentity'))),
 CHECK(length(CAST(intent_json AS BLOB))+COALESCE(length(CAST(anchor_json AS BLOB)),0)+512<=${namespaceCaps.singleton})
);
CREATE TRIGGER installed_namespace_initial BEFORE INSERT ON installed_staging_namespace BEGIN
 SELECT CASE WHEN EXISTS(SELECT 1 FROM installed_staging_namespace) OR EXISTS(SELECT 1 FROM accepted_attempts)
   OR NEW.state!='preparing' OR NOT EXISTS(SELECT 1 FROM journal_authority WHERE id=1 AND authority=json_extract(NEW.intent_json,'$.journalAuthority'))
   THEN RAISE(ABORT,'namespace requires fresh history') END;
END;
CREATE TRIGGER installed_namespace_immutable BEFORE UPDATE ON installed_staging_namespace BEGIN
 SELECT CASE WHEN NEW.id IS NOT OLD.id OR NEW.namespace_id IS NOT OLD.namespace_id OR NEW.intent_json IS NOT OLD.intent_json
   OR (OLD.state='bound' AND (NEW.state IS NOT OLD.state OR NEW.anchor_json IS NOT OLD.anchor_json OR NEW.namespace_identity IS NOT OLD.namespace_identity))
   THEN RAISE(ABORT,'immutable installed namespace') END;
END;
CREATE TRIGGER installed_namespace_retained BEFORE DELETE ON installed_staging_namespace BEGIN SELECT RAISE(ABORT,'retained installed namespace'); END;
ALTER TABLE accepted_attempts ADD COLUMN staging_namespace_identity TEXT REFERENCES installed_staging_namespace(namespace_identity);
ALTER TABLE accepted_attempts ADD COLUMN cleanup_control_version INTEGER NOT NULL DEFAULT 0 CHECK(cleanup_control_version IN (0,1));
ALTER TABLE accepted_attempts ADD COLUMN cleanup_control_bytes INTEGER NOT NULL DEFAULT 0 CHECK(typeof(cleanup_control_bytes)='integer' AND cleanup_control_bytes IN (0,${cleanupControl.reservedBytes}));
CREATE TRIGGER cleanup_control_initial BEFORE INSERT ON accepted_attempts
 WHEN NEW.cleanup_control_version!=0 OR NEW.cleanup_control_bytes!=0 OR NEW.staging_namespace_identity IS NOT NULL BEGIN SELECT RAISE(ABORT,'control reserve requires admission'); END;
CREATE TRIGGER cleanup_control_budget BEFORE UPDATE ON accepted_attempts BEGIN
 SELECT CASE WHEN NEW.spool_bytes+NEW.snapshot_bytes+NEW.checkpoint_bytes+NEW.hold_bytes+NEW.collection_bytes+NEW.source_bytes+NEW.delivery_bytes+NEW.absence_bytes+NEW.cleanup_control_bytes>NEW.quota_bytes
   THEN RAISE(ABORT,'cleanup control quota') END;
 SELECT CASE WHEN (NEW.cleanup_control_version=0)!=(NEW.cleanup_control_bytes=0) OR (NEW.cleanup_control_bytes=0)!=(NEW.staging_namespace_identity IS NULL)
   OR (OLD.cleanup_control_bytes!=0 AND (NEW.cleanup_control_version IS NOT OLD.cleanup_control_version OR NEW.cleanup_control_bytes IS NOT OLD.cleanup_control_bytes OR NEW.staging_namespace_identity IS NOT OLD.staging_namespace_identity))
   OR (NEW.cleanup_control_bytes!=0 AND NOT EXISTS(SELECT 1 FROM installed_staging_namespace n WHERE n.state='bound' AND n.namespace_identity=NEW.staging_namespace_identity))
   THEN RAISE(ABORT,'immutable cleanup control') END;
END;
CREATE TRIGGER cleanup_control_before_admission BEFORE INSERT ON reservations
 WHEN NOT EXISTS(SELECT 1 FROM accepted_attempts a JOIN installed_staging_namespace n ON n.namespace_identity=a.staging_namespace_identity
   WHERE a.attempt_id=NEW.attempt_id AND a.cleanup_control_version=1 AND a.cleanup_control_bytes=${cleanupControl.reservedBytes} AND n.state='bound')
 BEGIN SELECT RAISE(ABORT,'missing cleanup control reserve'); END;
CREATE TABLE task_staging_namespaces (
 attempt_id TEXT PRIMARY KEY REFERENCES reservations(attempt_id), namespace_identity TEXT NOT NULL REFERENCES installed_staging_namespace(namespace_identity),
 runtime_name TEXT NOT NULL,
 state TEXT NOT NULL CHECK(state IN ('preparing','prepared')),
 intent_json TEXT NOT NULL CHECK(length(CAST(intent_json AS BLOB))<=${namespaceCaps.task} AND task_namespace_intent_valid(intent_json)=1),
 anchor_json TEXT CHECK(anchor_json IS NULL OR (length(CAST(anchor_json AS BLOB))<=${namespaceCaps.task} AND task_namespace_anchor_valid(anchor_json,intent_json)=1)),
 task_namespace_identity TEXT UNIQUE,
 CHECK(attempt_id=json_extract(intent_json,'$.original.attemptId') AND namespace_identity=json_extract(intent_json,'$.namespaceIdentity')
   AND runtime_name=json_extract(intent_json,'$.runtimeName')),
 CHECK((state='preparing' AND anchor_json IS NULL AND task_namespace_identity IS NULL) OR
   (state='prepared' AND anchor_json IS NOT NULL AND task_namespace_identity=json_extract(anchor_json,'$.taskNamespaceIdentity'))),
 CHECK(length(CAST(intent_json AS BLOB))+COALESCE(length(CAST(anchor_json AS BLOB)),0)+${namespaceCaps.taskRowAllowance}<=${namespaceCaps.task}),
 UNIQUE(namespace_identity,runtime_name)
);
CREATE TRIGGER task_namespace_initial BEFORE INSERT ON task_staging_namespaces BEGIN
 SELECT CASE WHEN NEW.state!='preparing' OR EXISTS(SELECT 1 FROM task_staging_namespaces WHERE attempt_id=NEW.attempt_id)
   OR NOT EXISTS(SELECT 1 FROM accepted_attempts a JOIN reservations r ON r.attempt_id=a.attempt_id
      WHERE a.attempt_id=NEW.attempt_id AND a.staging_namespace_identity=NEW.namespace_identity AND a.cleanup_control_version=1 AND a.cleanup_control_bytes=${cleanupControl.reservedBytes}
      AND a.organization_id=json_extract(NEW.intent_json,'$.original.organizationId') AND a.workspace_id=json_extract(NEW.intent_json,'$.original.workspaceId')
      AND a.generation=json_extract(NEW.intent_json,'$.original.generation') AND a.intent_digest=json_extract(NEW.intent_json,'$.original.intentDigest')
      AND a.execution_purpose=json_extract(NEW.intent_json,'$.purpose') AND r.charged=1 AND json_extract(r.reservation_json,'$.aborted')=0
      AND json_extract(r.reservation_json,'$.createToken') IS NULL AND json_extract(r.reservation_json,'$.runtimeId') IS NULL
      AND json_extract(r.reservation_json,'$.specDigest') IS NULL AND json_extract(r.reservation_json,'$.launchEpoch')=0)
   THEN RAISE(ABORT,'invalid task namespace original') END;
END;
CREATE TRIGGER task_namespace_immutable BEFORE UPDATE ON task_staging_namespaces BEGIN
 SELECT CASE WHEN NEW.attempt_id IS NOT OLD.attempt_id OR NEW.namespace_identity IS NOT OLD.namespace_identity OR NEW.runtime_name IS NOT OLD.runtime_name OR NEW.intent_json IS NOT OLD.intent_json
   OR (OLD.state='prepared' AND (NEW.state IS NOT OLD.state OR NEW.anchor_json IS NOT OLD.anchor_json OR NEW.task_namespace_identity IS NOT OLD.task_namespace_identity))
   THEN RAISE(ABORT,'immutable task namespace') END;
END;
CREATE TRIGGER task_namespace_retained BEFORE DELETE ON task_staging_namespaces BEGIN SELECT RAISE(ABORT,'retained task namespace'); END;
PRAGMA user_version=16;
`;

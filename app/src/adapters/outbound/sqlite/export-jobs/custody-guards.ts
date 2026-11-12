import {stoppedExportSource} from './evidence.js';
export const exportCustodyGuards=`
CREATE TRIGGER export_original_insert BEFORE INSERT ON export_originals BEGIN
 SELECT CASE WHEN EXISTS(SELECT 1 FROM export_originals WHERE export_id=NEW.export_id)
 OR NOT EXISTS(SELECT 1 FROM export_jobs j WHERE j.id=NEW.export_id AND j.assignment_digest=NEW.assignment_digest
 AND j.possible_delivery=0 AND j.state='queued' AND j.cancellation_requested=0
 AND json_extract(NEW.assignment_json,'$.purpose')='standalone_export'
 AND json_extract(NEW.assignment_json,'$.assignmentDigest')=j.assignment_digest
 AND json_extract(NEW.assignment_json,'$.exportId')=j.id
 AND json_extract(NEW.assignment_json,'$.source.revisionId')=j.revision_id
 AND json_extract(NEW.assignment_json,'$.source.revisionDigest')=json_extract(j.intent_json,'$.revisionDigest')
 AND json_extract(NEW.assignment_json,'$.offer.attemptId')=j.attempt_id
 AND json_extract(NEW.assignment_json,'$.offer.organizationId')=j.organization_id
 AND json_extract(NEW.assignment_json,'$.offer.workspaceId')=j.workspace_id
 AND json_extract(NEW.assignment_json,'$.offer.intentDigest')=j.intent_digest
 AND json_extract(NEW.assignment_json,'$.offer.budget.cpuMillis')=j.cpu_millis
 AND json_extract(NEW.assignment_json,'$.offer.budget.memoryBytes')=j.memory_bytes
 AND json_extract(NEW.assignment_json,'$.offer.budget.pids')=j.pids
 AND json_extract(NEW.assignment_json,'$.offer.budget.timeoutMs')=j.timeout_ms
 AND json_extract(NEW.assignment_json,'$.offer.budget.outputBytes')=j.output_bytes
 AND json_extract(NEW.assignment_json,'$.offer.executionPolicy.mode')=j.mode
 AND json_array_length(NEW.assignment_json,'$.offer.inputs')=j.input_count
 AND json_extract(NEW.assignment_json,'$.options.maximumBuildBytes')=j.maximum_build_bytes
 AND json_extract(NEW.assignment_json,'$.options.scriptTimeoutMs')=json_extract(j.intent_json,'$.options.scriptTimeoutMs')
 AND json_extract(NEW.assignment_json,'$.offer.executionPolicy.preferIdle')=json_extract(j.intent_json,'$.executionPolicy.preferIdle')
 AND json_extract(NEW.profile_json,'$.engine')=json_extract(j.intent_json,'$.engine')
 AND json_extract(NEW.profile_json,'$.engine.id')=json_extract(NEW.assignment_json,'$.offer.engine.id')
 AND json_extract(NEW.profile_json,'$.engine.imageDigest')=json_extract(NEW.assignment_json,'$.offer.engine.imageDigest')
 AND json_extract(NEW.profile_json,'$.engine.configVersion')=json_extract(NEW.assignment_json,'$.offer.engine.configVersion')
 AND json_extract(NEW.profile_json,'$.installedIdentity')=json_extract(NEW.assignment_json,'$.offer.installedIdentity')
 AND json_extract(NEW.profile_json,'$.requiredCapabilities')=json_extract(NEW.assignment_json,'$.offer.requiredCapabilities'))
 THEN RAISE(ABORT,'export original mismatch') END;END;
CREATE TRIGGER export_original_immutable BEFORE UPDATE ON export_originals BEGIN SELECT RAISE(ABORT,'immutable export original');END;
CREATE TRIGGER export_original_retained BEFORE DELETE ON export_originals BEGIN SELECT RAISE(ABORT,'retained export original');END;
CREATE TRIGGER export_source_insert BEFORE INSERT ON export_sources BEGIN
 SELECT CASE WHEN EXISTS(SELECT 1 FROM export_sources WHERE export_id=NEW.export_id)
 OR EXISTS(SELECT 1 FROM export_absences WHERE export_id=NEW.export_id)
 OR NOT EXISTS(SELECT 1 FROM export_jobs j WHERE j.id=NEW.export_id AND j.assignment_digest=NEW.assignment_digest
 AND j.possible_delivery=1 AND j.journal_authority IS NOT NULL
 AND ${stoppedExportSource('j.snapshot_json','NEW.source_json','NEW.final_agent_seq')}
 AND json_extract(NEW.source_json,'$.manifest.manifestDigest')=NEW.manifest_digest
 AND json_extract(NEW.source_json,'$.sourceDigest')=NEW.source_digest
 AND json_extract(NEW.source_json,'$.closure.finalAgentSeq')=NEW.final_agent_seq
 AND json_extract(NEW.source_json,'$.manifest.binding.organizationId')=j.organization_id
 AND json_extract(NEW.source_json,'$.manifest.binding.workspaceId')=j.workspace_id
 AND json_extract(NEW.source_json,'$.manifest.binding.attemptId')=j.attempt_id
 AND json_extract(NEW.source_json,'$.manifest.binding.generation')=1
 AND json_extract(NEW.source_json,'$.manifest.binding.journalAuthority')=j.journal_authority
 AND json_extract(NEW.source_json,'$.manifest.binding.intentDigest')=j.intent_digest
 AND json_extract(NEW.source_json,'$.manifest.result.purpose')='standalone_export'
 AND json_extract(NEW.source_json,'$.manifest.result.exportId')=j.id
 AND json_extract(NEW.source_json,'$.manifest.result.assignmentDigest')=j.assignment_digest)
 THEN RAISE(ABORT,'export source mismatch') END;END;
CREATE TRIGGER export_source_immutable BEFORE UPDATE ON export_sources BEGIN SELECT RAISE(ABORT,'immutable export source');END;
CREATE TRIGGER export_source_retained BEFORE DELETE ON export_sources BEGIN SELECT RAISE(ABORT,'retained export source');END;
CREATE TRIGGER export_absence_insert BEFORE INSERT ON export_absences BEGIN
 SELECT CASE WHEN EXISTS(SELECT 1 FROM export_absences WHERE export_id=NEW.export_id)
 OR EXISTS(SELECT 1 FROM export_sources WHERE export_id=NEW.export_id)
 OR NOT EXISTS(SELECT 1 FROM export_jobs j WHERE j.id=NEW.export_id AND j.possible_delivery=1
 AND j.snapshot_json IS NOT NULL AND j.state NOT IN ('ready','failed','cancelled')
 AND json_extract(NEW.proof_json,'$.organizationId') IS j.organization_id
 AND json_extract(NEW.proof_json,'$.workspaceId') IS j.workspace_id
 AND json_extract(NEW.proof_json,'$.attemptId') IS j.attempt_id
 AND json_extract(NEW.proof_json,'$.generation') IS 1
 AND json_extract(NEW.proof_json,'$.intentDigest') IS j.intent_digest
 AND json_extract(NEW.proof_json,'$.journalAuthority') IS j.journal_authority
 AND json_extract(NEW.proof_json,'$.finalAgentSeq') IS json_extract(j.snapshot_json,'$.lastSeq')
 AND json_extract(NEW.proof_json,'$.admission') IS json_extract(j.snapshot_json,'$.admission')
 AND (json_extract(j.snapshot_json,'$.admission.state')='rejected' OR json_extract(j.snapshot_json,'$.state')='exited')
 AND json_type(j.snapshot_json,'$.result') IS NULL AND json_type(j.snapshot_json,'$.exportResult') IS NULL)
 THEN RAISE(ABORT,'export absence mismatch') END;END;
CREATE TRIGGER export_absence_immutable BEFORE UPDATE ON export_absences BEGIN SELECT RAISE(ABORT,'immutable export absence');END;
CREATE TRIGGER export_absence_retained BEFORE DELETE ON export_absences BEGIN SELECT RAISE(ABORT,'retained export absence');END;
CREATE TRIGGER export_artifact_insert BEFORE INSERT ON export_artifacts BEGIN
 SELECT CASE WHEN EXISTS(SELECT 1 FROM export_artifacts WHERE export_id=NEW.export_id OR token=NEW.token)
 OR NEW.offset!=0 OR NEW.phase!='transferring' OR NEW.identity IS NOT NULL OR NEW.writer IS NOT NULL OR NEW.version!=1
 OR NOT EXISTS(SELECT 1 FROM export_sources s JOIN export_jobs j ON j.id=s.export_id WHERE s.export_id=NEW.export_id
 AND json_extract(s.source_json,'$.manifest.result.status')='succeeded'
 AND json_extract(s.source_json,'$.manifest.result.artifact.artifactId')=NEW.artifact_id
 AND json_extract(s.source_json,'$.manifest.result.artifact.bytes')=NEW.bytes
 AND json_extract(s.source_json,'$.manifest.result.artifact.sha256')=NEW.sha256 AND NEW.bytes<=j.maximum_build_bytes)
 THEN RAISE(ABORT,'export artifact mismatch') END;END;
CREATE TRIGGER export_artifact_identity BEFORE UPDATE OF export_id,artifact_id,token,bytes,sha256 ON export_artifacts
 BEGIN SELECT RAISE(ABORT,'immutable export artifact');END;
CREATE TRIGGER export_artifact_retained BEFORE DELETE ON export_artifacts BEGIN SELECT RAISE(ABORT,'retained export artifact');END;
CREATE TRIGGER export_artifact_progress BEFORE UPDATE ON export_artifacts BEGIN
 SELECT CASE WHEN NEW.version!=OLD.version+1 OR NEW.offset<OLD.offset OR OLD.phase='published'
 OR (OLD.phase='publishing' AND NEW.phase!='published')
 OR (OLD.phase='transferring' AND NEW.phase='published')
 OR (OLD.writer IS NOT NULL AND NEW.writer IS NOT OLD.writer AND NOT(NEW.phase='published' AND NEW.writer IS NULL))
 OR (OLD.identity IS NOT NULL AND NEW.identity IS NOT OLD.identity AND NEW.phase!='published')
 THEN RAISE(ABORT,'invalid export artifact progression') END;END;
`;

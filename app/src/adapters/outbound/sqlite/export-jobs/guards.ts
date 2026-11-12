import {stoppedExportSource} from './evidence.js';
import {exportCustodyGuards} from './custody-guards.js';
const immutable=['id','organization_id','workspace_id','suite_id','revision_id','attempt_id','queue_order','source_profile','registry_digest',
 'assignment_digest','original_id','intent_digest','input_count','intent_json','cpu_millis','memory_bytes','pids','timeout_ms','output_bytes','staging_bytes','mode','maximum_build_bytes','metadata_charged'];
export const exportGuards=`
CREATE TRIGGER exports_insert BEFORE INSERT ON export_jobs BEGIN
 SELECT CASE WHEN EXISTS(SELECT 1 FROM export_jobs WHERE id=NEW.id OR attempt_id=NEW.attempt_id)
 THEN RAISE(ABORT,'retained export identity') END;
 SELECT CASE WHEN NEW.state!='queued' OR NEW.version!=1 OR NEW.possible_delivery!=0 OR NEW.execution_charged!=0
 OR NEW.output_charged!=0 OR NEW.snapshot_json IS NOT NULL OR NEW.journal_authority IS NOT NULL OR NEW.cancellation_requested!=0
 THEN RAISE(ABORT,'invalid fresh export') END;
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM execution_orders o WHERE o.queue_order=NEW.queue_order
 AND o.attempt_id=NEW.attempt_id AND o.purpose='standalone_export') THEN RAISE(ABORT,'export order mismatch') END;
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM suite_revisions r WHERE r.id=NEW.revision_id AND r.suite_id=NEW.suite_id
 AND r.organization_id=NEW.organization_id AND r.workspace_id=NEW.workspace_id
 AND r.digest=json_extract(NEW.intent_json,'$.revisionDigest')) THEN RAISE(ABORT,'export revision mismatch') END;
 SELECT CASE WHEN (SELECT charged_bytes FROM installation_storage_usage WHERE id=1)>9007199254740991-NEW.metadata_charged
 THEN RAISE(ABORT,'unsafe export charge') END;
END;
CREATE TRIGGER exports_charge AFTER INSERT ON export_jobs BEGIN
 UPDATE installation_storage_usage SET charged_bytes=charged_bytes+NEW.metadata_charged WHERE id=1;END;
CREATE TRIGGER exports_immutable BEFORE UPDATE OF ${immutable.join(',')} ON export_jobs
 BEGIN SELECT RAISE(ABORT,'immutable export intent');END;
CREATE TRIGGER exports_retained BEFORE DELETE ON export_jobs BEGIN SELECT RAISE(ABORT,'retained export custody');END;
CREATE TRIGGER exports_progress BEFORE UPDATE ON export_jobs BEGIN
 SELECT CASE WHEN NEW.version!=OLD.version+1 OR (OLD.cancellation_requested=1 AND NEW.cancellation_requested!=1)
 OR (OLD.possible_delivery=1 AND NEW.possible_delivery!=1)
 OR (OLD.journal_authority IS NOT NULL AND NEW.journal_authority IS NOT OLD.journal_authority)
 OR (OLD.state IN ('ready','failed','cancelled') AND (NEW.state!=OLD.state OR NEW.execution_charged!=0 OR NEW.output_charged!=OLD.output_charged))
 THEN RAISE(ABORT,'invalid export progression') END;
 SELECT CASE WHEN (SELECT charged_bytes FROM installation_storage_usage WHERE id=1)<OLD.output_charged
 OR (SELECT charged_bytes FROM installation_storage_usage WHERE id=1)-OLD.output_charged>9007199254740991-NEW.output_charged
 THEN RAISE(ABORT,'unsafe export charge') END;
 SELECT CASE WHEN NEW.possible_delivery=0 AND (NEW.execution_charged!=0 OR NEW.output_charged!=0)
 THEN RAISE(ABORT,'export charge without delivery') END;
 SELECT CASE WHEN NEW.state='ready' AND (NEW.execution_charged!=0 OR NOT EXISTS(
 SELECT 1 FROM export_sources s JOIN export_artifacts a ON a.export_id=s.export_id WHERE s.export_id=NEW.id
 AND json_extract(s.source_json,'$.manifest.result.status')='succeeded' AND a.phase='published'
 AND a.offset=a.bytes AND a.writer IS NULL AND a.identity IS NOT NULL AND NEW.output_charged=a.bytes
 AND NEW.reason IS NULL AND ${stoppedExportSource('NEW.snapshot_json','s.source_json','s.final_agent_seq')}))
 THEN RAISE(ABORT,'export publication missing') END;
 SELECT CASE WHEN NEW.state IN ('failed','cancelled') AND NEW.possible_delivery=1 AND (NEW.execution_charged!=0 OR NEW.output_charged!=0
 OR NOT EXISTS(SELECT 1 FROM export_sources s WHERE s.export_id=NEW.id
 AND json_extract(s.source_json,'$.manifest.result.status') IN ('failed','cancelled'))
 AND NOT EXISTS(SELECT 1 FROM export_absences WHERE export_id=NEW.id))
 THEN RAISE(ABORT,'export terminal custody missing') END;
 SELECT CASE WHEN NEW.execution_charged=0 AND OLD.execution_charged=1
 AND NOT EXISTS(SELECT 1 FROM export_sources s WHERE s.export_id=NEW.id
 AND ${stoppedExportSource('NEW.snapshot_json','s.source_json','s.final_agent_seq')})
 AND NOT EXISTS(SELECT 1 FROM export_absences WHERE export_id=NEW.id) THEN RAISE(ABORT,'export release custody missing') END;
END;
CREATE TRIGGER exports_delivery BEFORE UPDATE OF possible_delivery ON export_jobs WHEN OLD.possible_delivery=0 AND NEW.possible_delivery=1 BEGIN
 SELECT CASE WHEN NEW.execution_charged!=1 OR NEW.output_charged!=NEW.maximum_build_bytes OR NEW.journal_authority IS NULL
 OR NEW.snapshot_json IS NOT NULL OR OLD.cancellation_requested!=0 OR OLD.state!='queued' OR NEW.state!='dispatching'
 OR (SELECT COUNT(*) FROM export_input_pins WHERE export_id=OLD.id)!=OLD.input_count
 THEN RAISE(ABORT,'invalid export delivery claim') END;END;
CREATE TRIGGER exports_snapshot BEFORE UPDATE OF snapshot_json ON export_jobs WHEN NEW.snapshot_json IS NOT NULL BEGIN
 SELECT CASE WHEN json_extract(NEW.snapshot_json,'$.attemptId') IS NOT OLD.attempt_id
 OR json_extract(NEW.snapshot_json,'$.organizationId') IS NOT OLD.organization_id
 OR json_extract(NEW.snapshot_json,'$.workspaceId') IS NOT OLD.workspace_id
 OR json_extract(NEW.snapshot_json,'$.generation') IS NOT 1
 OR json_extract(NEW.snapshot_json,'$.intentDigest') IS NOT OLD.intent_digest
 OR json_type(NEW.snapshot_json,'$.result') IS NOT NULL
 OR (json_type(NEW.snapshot_json,'$.exportResult') IS NOT NULL
 AND json_extract(NEW.snapshot_json,'$.exportResult.assignmentDigest') IS NOT OLD.assignment_digest)
 THEN RAISE(ABORT,'export snapshot mismatch') END;END;
CREATE TRIGGER exports_recharge AFTER UPDATE OF output_charged ON export_jobs BEGIN
 UPDATE installation_storage_usage SET charged_bytes=charged_bytes-OLD.output_charged+NEW.output_charged WHERE id=1;END;
CREATE TRIGGER export_pin_insert BEFORE INSERT ON export_input_pins BEGIN
 SELECT CASE WHEN EXISTS(SELECT 1 FROM export_input_pins WHERE export_id=NEW.export_id AND input_id=NEW.input_id)
 OR NOT EXISTS(SELECT 1 FROM export_jobs j JOIN export_originals o ON o.export_id=j.id JOIN json_each(o.assignment_json,'$.offer.inputs') p
 JOIN input_blobs b ON b.organization_id=NEW.organization_id AND b.workspace_id=NEW.workspace_id AND b.id=NEW.input_id
 WHERE j.id=NEW.export_id AND j.organization_id=NEW.organization_id AND j.workspace_id=NEW.workspace_id
 AND j.possible_delivery=0 AND b.state='published' AND b.sha256=NEW.sha256 AND b.bytes=NEW.bytes
 AND json_extract(p.value,'$.id')=NEW.input_id AND json_extract(p.value,'$.sha256')=NEW.sha256 AND json_extract(p.value,'$.bytes')=NEW.bytes)
 THEN RAISE(ABORT,'export input pin mismatch') END;END;
CREATE TRIGGER export_pin_immutable BEFORE UPDATE ON export_input_pins BEGIN SELECT RAISE(ABORT,'immutable export pin');END;
CREATE TRIGGER export_pin_retained BEFORE DELETE ON export_input_pins BEGIN SELECT RAISE(ABORT,'retained export pin');END;
CREATE TRIGGER export_input_retained BEFORE UPDATE OF state ON input_blobs WHEN NEW.state!='published'
 AND EXISTS(SELECT 1 FROM export_input_pins WHERE organization_id=OLD.organization_id AND workspace_id=OLD.workspace_id AND input_id=OLD.id)
 BEGIN SELECT RAISE(ABORT,'export input producer retained');END;
${exportCustodyGuards}
`;

import { cleanupControl } from '../../cleanup-control/index.js';
const q = (path: string) => `json_extract(NEW.intent_json,'$.${path}')`;
const source = q('request.closure.kind') + "='source'";
const sourceProof = `EXISTS(SELECT 1 FROM output_delivery_closures d JOIN output_sources s ON s.attempt_id=d.attempt_id
 JOIN task_staging_namespaces t ON t.attempt_id=s.attempt_id
 JOIN installed_staging_namespace n ON n.namespace_identity=t.namespace_identity
 WHERE d.attempt_id=a.attempt_id AND t.state='prepared'
 AND json_extract(d.closure_json,'$.finalAgentSeq')=${q('request.closure.finalAgentSeq')}
 AND json_extract(d.closure_json,'$.receipt.journalAuthority')=${q('request.journalAuthority')}
 AND json_extract(d.closure_json,'$.receipt.sourceDigest')=${q('request.closure.sourceDigest')}
 AND json_extract(d.closure_json,'$.receipt.manifestDigest')=${q('request.closure.manifestDigest')}
 AND json_extract(t.intent_json,'$.specDigest')=json_extract(r.reservation_json,'$.specDigest')
 AND json_extract(t.anchor_json,'$.directories.output.dev')=json_extract(s.source_json,'$.root.device')
 AND json_extract(t.anchor_json,'$.directories.output.ino')=json_extract(s.source_json,'$.root.inode')
 AND json_extract(t.anchor_json,'$.directories.output.uid')=CAST(json_extract(s.source_json,'$.root.uid') AS TEXT)
 AND json_extract(s.source_json,'$.root.directory')=rtrim(json_extract(n.intent_json,'$.root.target'),'/')||'/'||t.runtime_name||'/output')`;
const absenceProof = `EXISTS(SELECT 1 FROM output_absence_closures z WHERE z.attempt_id=a.attempt_id
 AND json_extract(z.proof_json,'$.finalAgentSeq')=${q('request.closure.finalAgentSeq')}
 AND retirement_absence_digest(z.proof_json)=${q('request.closure.proofDigest')})`;
export const retirementTables = `
CREATE TABLE output_retirement_intents (
 attempt_id TEXT PRIMARY KEY REFERENCES accepted_attempts(attempt_id),
 request_digest TEXT NOT NULL UNIQUE CHECK(typeof(request_digest)='text' AND length(request_digest)=64),
 namespace_identity TEXT NOT NULL REFERENCES installed_staging_namespace(namespace_identity),
 task_namespace_identity TEXT REFERENCES task_staging_namespaces(task_namespace_identity),
 intent_json TEXT NOT NULL CHECK(typeof(intent_json)='text' AND length(CAST(intent_json AS BLOB))<=${cleanupControl.intentBytes}
   AND retirement_intent_valid(intent_json)=1),
 CHECK(attempt_id=${q('request.attemptId').replaceAll('NEW.', '')}),
 CHECK(request_digest=${q('requestDigest').replaceAll('NEW.', '')}),
 CHECK(namespace_identity=${q('namespaceIdentity').replaceAll('NEW.', '')}),
 CHECK(task_namespace_identity IS ${q('task.taskNamespaceIdentity').replaceAll('NEW.', '')})
);
CREATE TRIGGER retirement_initial BEFORE INSERT ON output_retirement_intents BEGIN
 SELECT CASE WHEN EXISTS(SELECT 1 FROM output_retirement_intents WHERE attempt_id=NEW.attempt_id)
 OR NOT EXISTS(SELECT 1 FROM accepted_attempts a JOIN reservations r ON r.attempt_id=a.attempt_id
 JOIN installed_staging_namespace n ON n.namespace_identity=a.staging_namespace_identity
 LEFT JOIN task_staging_namespaces t ON t.attempt_id=a.attempt_id
 WHERE a.attempt_id=NEW.attempt_id AND a.organization_id=${q('request.organizationId')} AND a.workspace_id=${q('request.workspaceId')}
 AND a.generation=${q('request.generation')} AND a.intent_digest=${q('request.intentDigest')} AND a.execution_purpose='performance'
 AND a.cleanup_control_version=1 AND a.cleanup_control_bytes=${cleanupControl.reservedBytes}
 AND n.state='bound' AND n.namespace_identity=NEW.namespace_identity
 AND (t.attempt_id IS NULL OR t.namespace_identity=NEW.namespace_identity)
 AND retirement_task_matches(NEW.intent_json,t.state,t.intent_json,t.anchor_json)=1
 AND ${q('request.journalAuthority')}=(SELECT authority FROM journal_authority WHERE id=1)
 AND r.charged=0 AND json_extract(r.reservation_json,'$.status')='released'
 AND a.last_seq=${q('request.closure.finalAgentSeq')} AND a.acknowledged_seq>=a.last_seq
 AND ((${source} AND ${sourceProof}) OR (${q('request.closure.kind')}='absence' AND ${absenceProof})))
 THEN RAISE(ABORT,'invalid retirement original') END;
END;
CREATE TRIGGER retirement_immutable BEFORE UPDATE ON output_retirement_intents BEGIN SELECT RAISE(ABORT,'immutable retirement intent'); END;
CREATE TRIGGER retirement_retained BEFORE DELETE ON output_retirement_intents BEGIN SELECT RAISE(ABORT,'retained retirement intent'); END;
`;
function fenced(table: string, column: string): string {
  return `EXISTS(SELECT 1 FROM output_retirement_intents WHERE attempt_id=${table}.${column})`;
}
function preventInsert(table: string, column: string): string {
  return `CREATE TRIGGER retirement_${table}_insert BEFORE INSERT ON ${table} WHEN ${fenced('NEW', column)}
 BEGIN SELECT RAISE(ABORT,'retired producer'); END;`;
}
export const retirementFences = [
  preventInsert('reservations', 'attempt_id'), preventInsert('task_staging_namespaces', 'attempt_id'),
  preventInsert('output_collection_intents', 'attempt_id'), preventInsert('output_sources', 'attempt_id'),
  preventInsert('event_spool', 'attempt_id'),
  `CREATE TRIGGER retirement_reservation_update BEFORE UPDATE ON reservations WHEN ${fenced('OLD', 'attempt_id')}
   AND (NEW.charged IS NOT OLD.charged OR NEW.reservation_json IS NOT OLD.reservation_json)
   BEGIN SELECT RAISE(ABORT,'retired reservation'); END;`,
  `CREATE TRIGGER retirement_task_update BEFORE UPDATE ON task_staging_namespaces WHEN ${fenced('OLD', 'attempt_id')}
   AND (NEW.state IS NOT OLD.state OR NEW.anchor_json IS NOT OLD.anchor_json OR NEW.task_namespace_identity IS NOT OLD.task_namespace_identity)
   BEGIN SELECT RAISE(ABORT,'retired task preparation'); END;`,
  `CREATE TRIGGER retirement_collection_update BEFORE UPDATE ON output_collection_intents WHEN ${fenced('OLD', 'attempt_id')}
   AND (NEW.phase IS NOT OLD.phase OR NEW.intent_json IS NOT OLD.intent_json)
   BEGIN SELECT RAISE(ABORT,'retired collection'); END;`,
  `CREATE TRIGGER retirement_queue_update BEFORE UPDATE ON admission_queue WHEN ${fenced('OLD', 'attempt_id')} AND NEW.pending!=0
   BEGIN SELECT RAISE(ABORT,'retired queue'); END;`,
].join('\n');

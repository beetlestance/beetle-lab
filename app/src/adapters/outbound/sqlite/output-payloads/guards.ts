const resultPath = "CASE NEW.kind WHEN 'result' THEN '$' ELSE '$.result' END";
const identity = (['organizationId', 'workspaceId', 'attemptId'] as const).map(field => {
  const column = { organizationId: 'organization_id', workspaceId: 'workspace_id', attemptId: 'attempt_id' }[field];
  return `json_extract(NEW.canonical_json,${resultPath}||'.${field}') IS e.${column}`;
}).join(' AND ');
const manifestBinding = (['organizationId', 'workspaceId', 'attemptId', 'intentDigest', 'journalAuthority'] as const).map(field => {
  const column = { organizationId: 'organization_id', workspaceId: 'workspace_id', attemptId: 'attempt_id', intentDigest: 'intent_digest', journalAuthority: 'journal_authority' }[field];
  return `json_extract(NEW.canonical_json,'$.binding.${field}') IS e.${column}`;
}).join(' AND ');
function bodyGuard(): string {
  return `SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM execution_records e JOIN attempt_output_allocations a ON a.attempt_id=e.attempt_id
   WHERE e.attempt_id=NEW.attempt_id AND e.journal_authority IS NOT NULL AND ${identity}
   AND json_type(NEW.canonical_json,${resultPath}||'.generation') IS 'integer'
   AND json_extract(NEW.canonical_json,${resultPath}||'.generation') IS 1
   AND (NEW.kind='result' OR (e.acknowledged_generation IS 1 AND ${manifestBinding}
    AND json_type(NEW.canonical_json,'$.version') IS 'integer' AND json_extract(NEW.canonical_json,'$.version') IS 1
    AND json_type(NEW.canonical_json,'$.binding.generation') IS 'integer' AND json_extract(NEW.canonical_json,'$.binding.generation') IS 1)))
  THEN RAISE(ABORT,'payload requires original identity') END;
 SELECT CASE WHEN NEW.kind='manifest' AND (
  json_type(NEW.canonical_json,'$.result.artifacts') IS NOT 'array' OR json_array_length(NEW.canonical_json,'$.result.artifacts')>128
  OR EXISTS(SELECT 1 FROM json_each(NEW.canonical_json,'$.result.artifacts') WHERE json_type(value,'$.bytes') IS NOT 'integer'
   OR typeof(json_extract(value,'$.bytes'))!='integer' OR json_extract(value,'$.bytes') NOT BETWEEN 0 AND 9007199254740991))
 THEN RAISE(ABORT,'unsafe artifact charge') END;
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM attempt_output_allocations a WHERE a.attempt_id=NEW.attempt_id
  AND length(CAST(NEW.canonical_json AS BLOB))<=a.maximum_payload_bytes
  AND (CASE NEW.kind WHEN 'manifest' THEN coalesce((SELECT sum(json_extract(value,'$.bytes'))
   FROM json_each(NEW.canonical_json,'$.result.artifacts')),0) ELSE 0 END)<=a.maximum_payload_bytes-length(CAST(NEW.canonical_json AS BLOB))
  AND coalesce((SELECT retained_bytes FROM event_cursors WHERE attempt_id=NEW.attempt_id),0)<=a.maximum_payload_bytes
   -length(CAST(NEW.canonical_json AS BLOB))-(CASE NEW.kind WHEN 'manifest' THEN coalesce((SELECT sum(json_extract(value,'$.bytes'))
    FROM json_each(NEW.canonical_json,'$.result.artifacts')),0) ELSE 0 END))
 THEN RAISE(ABORT,'payload allowance exceeded') END;`;
}
export const payloadGuards = `
CREATE TRIGGER output_payload_insert BEFORE INSERT ON execution_output_payloads BEGIN
 SELECT CASE WHEN EXISTS(SELECT 1 FROM execution_output_payloads WHERE attempt_id=NEW.attempt_id)
 THEN RAISE(ABORT,'retained output payload') END;
 ${bodyGuard()} END;
CREATE TRIGGER output_payload_update BEFORE UPDATE ON execution_output_payloads BEGIN
 SELECT CASE WHEN NEW.attempt_id IS NOT OLD.attempt_id OR NOT (
  (NEW.kind IS OLD.kind AND NEW.canonical_json IS OLD.canonical_json) OR
  (OLD.kind='result' AND NEW.kind='manifest' AND json_extract(NEW.canonical_json,'$.result') IS OLD.canonical_json))
 THEN RAISE(ABORT,'immutable output payload') END;
 ${bodyGuard()} END;
CREATE TRIGGER output_payload_retained BEFORE DELETE ON execution_output_payloads
 BEGIN SELECT RAISE(ABORT,'retained output payload'); END;
`;
export const headerGuards = `
CREATE TRIGGER output_header_insert BEFORE INSERT ON execution_records WHEN NEW.result_observed!=0
 BEGIN SELECT RAISE(ABORT,'new execution has no result observation'); END;
CREATE TRIGGER output_header_update BEFORE UPDATE ON execution_records BEGIN
 SELECT CASE WHEN NEW.result_observed<OLD.result_observed THEN RAISE(ABORT,'monotonic result observation') END;
 SELECT CASE WHEN NEW.snapshot_json IS NOT NULL AND (length(CAST(NEW.snapshot_json AS BLOB))>2048
  OR json_type(NEW.snapshot_json,'$.result') IS NOT NULL
  OR EXISTS(SELECT 1 FROM json_each(NEW.snapshot_json) WHERE key NOT IN
   ('protocolVersion','organizationId','workspaceId','attemptId','generation','intentDigest','state','phase','lastSeq','retainedStartSeq','cancelRequested','exitEvidence','admission'))
  OR (SELECT count(*) FROM json_each(NEW.snapshot_json))!=(SELECT count(DISTINCT key) FROM json_each(NEW.snapshot_json))) THEN RAISE(ABORT,'bounded result-free header') END;
 SELECT CASE WHEN NEW.result_observed=1 AND (NEW.snapshot_json IS NULL OR NOT EXISTS(
  SELECT 1 FROM execution_output_payloads p WHERE p.attempt_id=NEW.attempt_id))
 THEN RAISE(ABORT,'observed result requires carrier') END; END;
`;

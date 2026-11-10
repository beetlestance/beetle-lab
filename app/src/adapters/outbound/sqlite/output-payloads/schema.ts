export const payloadSchema = `
ALTER TABLE execution_records ADD COLUMN result_observed INTEGER NOT NULL DEFAULT 0
 CHECK(typeof(result_observed)='integer' AND result_observed IN (0,1));
CREATE TABLE execution_output_payloads (
 attempt_id TEXT PRIMARY KEY REFERENCES execution_records(attempt_id),
 kind TEXT NOT NULL CHECK(kind IN ('result','manifest')),
 canonical_json TEXT NOT NULL CHECK(typeof(canonical_json)='text' AND json_valid(canonical_json)
  AND length(CAST(canonical_json AS BLOB)) BETWEEN 1 AND CASE kind WHEN 'result' THEN 65536 ELSE 73728 END));
CREATE VIEW execution_output_charges AS SELECT attempt_id,length(CAST(canonical_json AS BLOB)) body_bytes,
 CASE kind WHEN 'manifest' THEN coalesce((SELECT sum(json_extract(value,'$.bytes'))
  FROM json_each(canonical_json,'$.result.artifacts')),0) ELSE 0 END artifact_bytes
 FROM execution_output_payloads;
`;

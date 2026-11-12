/** Bounded derived history metadata; existing payload/metadata charges do not change. */
export const migration018 = `
ALTER TABLE runs ADD COLUMN history_summary_json TEXT CHECK(history_summary_json IS NULL OR (
 typeof(history_summary_json)='text' AND length(CAST(history_summary_json AS BLOB))<=2048 AND json_valid(history_summary_json)));
ALTER TABLE runs ADD COLUMN history_summary_due_ms INTEGER NOT NULL DEFAULT 0
 CHECK(typeof(history_summary_due_ms)='integer' AND history_summary_due_ms BETWEEN 0 AND 8640000000000000);
CREATE INDEX run_history_due ON runs(history_summary_due_ms,id)
 WHERE state IN ('finished','cancelled','errored') AND history_summary_json IS NULL;
CREATE TRIGGER history_summary_initial BEFORE INSERT ON runs
 WHEN NEW.history_summary_json IS NOT NULL OR NEW.history_summary_due_ms!=0
 BEGIN SELECT RAISE(ABORT,'new run cannot contain history projection'); END;
CREATE TRIGGER history_summary_retained BEFORE UPDATE OF history_summary_json ON runs
 WHEN OLD.history_summary_json IS NOT NULL AND NEW.history_summary_json IS NOT OLD.history_summary_json
 BEGIN SELECT RAISE(ABORT,'retained history projection'); END;
CREATE TRIGGER history_summary_capture BEFORE UPDATE OF history_summary_json ON runs
 WHEN NEW.history_summary_json IS NOT NULL BEGIN
 SELECT CASE WHEN valid_history_summary(NEW.history_summary_json,NEW.id,NEW.active_attempt_id)!=1
  OR NEW.state NOT IN ('finished','cancelled','errored')
  OR json_extract(NEW.history_summary_json,'$.retainedLogicalBytes') IS NOT NULL
  OR json_extract(NEW.history_summary_json,'$.metadataAllowanceBytes') IS NOT NULL
  OR json_extract(NEW.history_summary_json,'$.availability')='pending'
 THEN RAISE(ABORT,'invalid history projection') END;
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM execution_output_finalizations f
  WHERE f.run_id=NEW.id AND f.attempt_id=NEW.active_attempt_id AND f.organization_id=NEW.organization_id AND f.workspace_id=NEW.workspace_id)
  AND NOT (json_extract(NEW.history_summary_json,'$.availability')='not_recorded'
   AND EXISTS(SELECT 1 FROM execution_output_absence_finalizations f
    WHERE f.run_id=NEW.id AND f.attempt_id=NEW.active_attempt_id AND f.organization_id=NEW.organization_id AND f.workspace_id=NEW.workspace_id))
 THEN RAISE(ABORT,'history requires retained source facts') END;
 SELECT CASE WHEN json_extract(NEW.history_summary_json,'$.availability')='ready' AND NOT EXISTS(
  SELECT 1 FROM execution_output_finalizations f JOIN execution_output_payloads p ON p.attempt_id=f.attempt_id AND p.kind='manifest',
   json_each(p.canonical_json,'$.result.artifacts') a
  WHERE f.attempt_id=NEW.active_attempt_id AND f.generation=1
   AND json_extract(NEW.history_summary_json,'$.source.generation')=f.generation
   AND json_extract(NEW.history_summary_json,'$.source.manifestDigest')=f.manifest_digest
   AND json_extract(a.value,'$.kind')='numeric-final'
   AND json_extract(a.value,'$.artifactId')=json_extract(NEW.history_summary_json,'$.source.numericArtifactId')
   AND json_extract(a.value,'$.sha256')=json_extract(NEW.history_summary_json,'$.source.numericSha256'))
 THEN RAISE(ABORT,'history numeric source mismatch') END;
 SELECT CASE WHEN json_extract(NEW.history_summary_json,'$.publishedArtifactBytes') IS NOT NULL AND NOT EXISTS(
  SELECT 1 FROM execution_output_payloads p WHERE p.attempt_id=NEW.active_attempt_id AND p.kind='manifest'
   AND json_extract(NEW.history_summary_json,'$.publishedArtifactBytes')=
    coalesce((SELECT sum(json_extract(value,'$.bytes')) FROM json_each(p.canonical_json,'$.result.artifacts')),0))
 THEN RAISE(ABORT,'history catalogue bytes mismatch') END;
END;
PRAGMA user_version=18;
`;

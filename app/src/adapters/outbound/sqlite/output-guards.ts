/** Output stays reserved until a separately owned artifact migration adds settlement. */
export const outputGuards = `
CREATE TRIGGER output_insert BEFORE INSERT ON attempt_output_allocations BEGIN
 SELECT CASE WHEN EXISTS(SELECT 1 FROM attempt_output_allocations WHERE attempt_id=NEW.attempt_id)
 THEN RAISE(ABORT,'retained output allocation') END;
 SELECT CASE WHEN NEW.version!=1 OR NOT EXISTS(SELECT 1 FROM execution_intents i
 WHERE i.attempt_id=NEW.attempt_id AND i.run_id=NEW.run_id AND i.organization_id=NEW.organization_id
 AND i.workspace_id=NEW.workspace_id AND i.output_bytes=NEW.maximum_payload_bytes)
 THEN RAISE(ABORT,'invalid output allocation') END;
 SELECT CASE WHEN (SELECT charged_bytes FROM installation_storage_usage WHERE id=1)>9007199254740991-NEW.charged_bytes
 THEN RAISE(ABORT,'unsafe output charge') END; END;
CREATE TRIGGER output_charge AFTER INSERT ON attempt_output_allocations BEGIN
 UPDATE installation_storage_usage SET charged_bytes=charged_bytes+NEW.charged_bytes WHERE id=1; END;
CREATE TRIGGER output_immutable BEFORE UPDATE ON attempt_output_allocations BEGIN SELECT RAISE(ABORT,'immutable output allocation'); END;
CREATE TRIGGER output_retained BEFORE DELETE ON attempt_output_allocations BEGIN SELECT RAISE(ABORT,'retained output allocation'); END;
`;

/** Bind new possible deliveries; prior ownership remains unbound and fenced. */
export const migration006 = `
ALTER TABLE execution_records ADD COLUMN journal_authority TEXT CHECK(journal_authority IS NULL OR (
 typeof(journal_authority)='text' AND length(CAST(journal_authority AS BLOB))=36 AND length(journal_authority)=36 AND
 substr(journal_authority,9,1)='-' AND substr(journal_authority,14,1)='-' AND
 substr(journal_authority,19,1)='-' AND substr(journal_authority,24,1)='-' AND
 length(replace(journal_authority,'-',''))=32 AND replace(journal_authority,'-','') NOT GLOB '*[^0-9a-f]*'));
CREATE INDEX execution_unbound_authority ON execution_records(attempt_id) WHERE journal_authority IS NULL AND execution_charged=1;
CREATE TRIGGER execution_authority_insert BEFORE INSERT ON execution_records WHEN NEW.journal_authority IS NULL
 BEGIN SELECT RAISE(ABORT,'new delivery requires journal authority'); END;
CREATE TRIGGER execution_authority_immutable BEFORE UPDATE ON execution_records
 WHEN NEW.journal_authority IS NOT OLD.journal_authority OR OLD.journal_authority IS NULL
 BEGIN SELECT RAISE(ABORT,'immutable delivery authority'); END;
PRAGMA user_version=6;
`;

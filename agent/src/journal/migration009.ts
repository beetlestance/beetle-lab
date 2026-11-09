// The insert guard runs before SQLite's implicit REPLACE deletion, even when
// recursive triggers are disabled. There is no runtime identity mutation path.
export const migration009 = `
  CREATE TABLE journal_authority (
    id INTEGER PRIMARY KEY CHECK(id=1),
    authority TEXT CHECK(authority IS NULL OR (
      typeof(authority)='text' AND length(CAST(authority AS BLOB))=36
      AND substr(authority,9,1)='-' AND substr(authority,14,1)='-'
      AND substr(authority,19,1)='-' AND substr(authority,24,1)='-'
      AND length(replace(authority,'-',''))=32
      AND replace(authority,'-','') NOT GLOB '*[^0-9a-f]*'
    ))
  );
  CREATE TRIGGER journal_authority_no_insert BEFORE INSERT ON journal_authority
    WHEN EXISTS(SELECT 1 FROM journal_authority)
    BEGIN SELECT RAISE(ABORT,'immutable journal authority'); END;
  CREATE TRIGGER journal_authority_no_update BEFORE UPDATE ON journal_authority
    BEGIN SELECT RAISE(ABORT,'immutable journal authority'); END;
  CREATE TRIGGER journal_authority_no_delete BEFORE DELETE ON journal_authority
    BEGIN SELECT RAISE(ABORT,'immutable journal authority'); END;
  PRAGMA user_version=9;
`;

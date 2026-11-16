/** Fresh refusal is retained for the lifetime of its immutable original receipt. */
export const migration010 = `
  CREATE TABLE cancelled_originals (
    attempt_id TEXT NOT NULL PRIMARY KEY REFERENCES accepted_attempts(attempt_id),
    generation INTEGER NOT NULL CHECK(generation=1)
  );
  CREATE TRIGGER cancelled_originals_no_insert BEFORE INSERT ON cancelled_originals
    WHEN EXISTS(SELECT 1 FROM cancelled_originals WHERE attempt_id=NEW.attempt_id)
    BEGIN SELECT RAISE(ABORT,'immutable cancelled original'); END;
  CREATE TRIGGER cancelled_originals_no_update BEFORE UPDATE ON cancelled_originals
    BEGIN SELECT RAISE(ABORT,'immutable cancelled original'); END;
  CREATE TRIGGER cancelled_originals_no_delete BEFORE DELETE ON cancelled_originals
    BEGIN SELECT RAISE(ABORT,'immutable cancelled original'); END;
  PRAGMA user_version=10;
`;

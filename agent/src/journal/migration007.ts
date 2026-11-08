export const migration007 = `
  ALTER TABLE supervision_clock ADD COLUMN cancel_reason TEXT
    CHECK(cancel_reason IN ('cancelled','timeout','output_limit','artifact_incomplete','clock_integrity'));
  ALTER TABLE supervision_clock ADD COLUMN stop_immediate INTEGER NOT NULL DEFAULT 0
    CHECK(stop_immediate IN (0,1));
  PRAGMA user_version=7;
`;

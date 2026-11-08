/** Unpublished v4 rows keep unknown projections; original retained events are untouched. */
export const migration005 = `
  ALTER TABLE accepted_attempts ADD COLUMN phase TEXT
    CHECK(phase IN ('validate','prepare','execute','collect','seal'));
  ALTER TABLE accepted_attempts ADD COLUMN exit_json TEXT CHECK(length(CAST(exit_json AS BLOB))<=1024);
  ALTER TABLE accepted_attempts ADD COLUMN result_json TEXT CHECK(length(CAST(result_json AS BLOB))<=65536);
  ALTER TABLE accepted_attempts ADD COLUMN snapshot_bytes INTEGER NOT NULL DEFAULT 0
    CHECK(snapshot_bytes BETWEEN 0 AND 66568 AND snapshot_bytes+spool_bytes<=quota_bytes);
  PRAGMA user_version=5;
`;

import { DISK_HOLD_LIMIT, DISK_HOLD_METADATA_BYTES, MAX_DISK_TOTAL, MAX_RESOURCE_VALUE } from '../../admission/index.js';

export const tables = `
  ALTER TABLE accepted_attempts ADD COLUMN hold_bytes INTEGER NOT NULL DEFAULT 0
    CHECK(typeof(hold_bytes)='integer' AND hold_bytes IN (0,${DISK_HOLD_METADATA_BYTES})
      AND hold_bytes+spool_bytes+snapshot_bytes+checkpoint_bytes<=quota_bytes);
  CREATE TABLE disk_holds (
    attempt_id TEXT PRIMARY KEY REFERENCES reservations(attempt_id),
    organization_id TEXT NOT NULL, workspace_id TEXT NOT NULL,
    generation INTEGER NOT NULL CHECK(generation=1), intent_digest TEXT NOT NULL,
    output_bytes INTEGER NOT NULL CHECK(typeof(output_bytes)='integer' AND output_bytes BETWEEN 1 AND ${MAX_RESOURCE_VALUE}),
    staging_bytes INTEGER NOT NULL CHECK(typeof(staging_bytes)='integer' AND staging_bytes BETWEEN 0 AND ${MAX_RESOURCE_VALUE}),
    metadata_bytes INTEGER NOT NULL CHECK(metadata_bytes=${DISK_HOLD_METADATA_BYTES}),
    phase TEXT NOT NULL CHECK(phase IN ('active','retained'))
  );
  CREATE TABLE disk_retention_stats (
    id INTEGER PRIMARY KEY CHECK(id=1),
    held_count INTEGER NOT NULL CHECK(typeof(held_count)='integer' AND held_count BETWEEN 0 AND ${DISK_HOLD_LIMIT}),
    held_output_bytes INTEGER NOT NULL CHECK(typeof(held_output_bytes)='integer' AND held_output_bytes BETWEEN 0 AND ${MAX_DISK_TOTAL}),
    held_staging_bytes INTEGER NOT NULL CHECK(typeof(held_staging_bytes)='integer' AND held_staging_bytes BETWEEN 0 AND ${MAX_DISK_TOTAL}),
    retained_output_bytes INTEGER NOT NULL CHECK(typeof(retained_output_bytes)='integer' AND retained_output_bytes BETWEEN 0 AND held_output_bytes),
    retained_staging_bytes INTEGER NOT NULL CHECK(typeof(retained_staging_bytes)='integer' AND retained_staging_bytes BETWEEN 0 AND held_staging_bytes)
  );
  INSERT INTO disk_retention_stats VALUES(1,0,0,0,0,0);
`;

const aggregate = (column: string, retained = false): string =>
  `(SELECT COALESCE(SUM(${column}),0) FROM disk_holds${retained ? " WHERE phase='retained'" : ''})`;
const statsMatch = `NEW.id=1 AND NEW.held_count=(SELECT COUNT(*) FROM disk_holds)
  AND NEW.held_output_bytes=${aggregate('output_bytes')} AND NEW.held_staging_bytes=${aggregate('staging_bytes')}
  AND NEW.retained_output_bytes=${aggregate('output_bytes', true)} AND NEW.retained_staging_bytes=${aggregate('staging_bytes', true)}`;
const updateStats = `UPDATE disk_retention_stats SET held_count=(SELECT COUNT(*) FROM disk_holds),
  held_output_bytes=${aggregate('output_bytes')}, held_staging_bytes=${aggregate('staging_bytes')},
  retained_output_bytes=${aggregate('output_bytes', true)}, retained_staging_bytes=${aggregate('staging_bytes', true)} WHERE id=1;
  SELECT CASE WHEN changes()!=1 THEN RAISE(ABORT,'missing retention counters') END;`;
export const initializeStats = `UPDATE disk_retention_stats SET held_count=(SELECT COUNT(*) FROM disk_holds),
  held_output_bytes=${aggregate('output_bytes')}, held_staging_bytes=${aggregate('staging_bytes')},
  retained_output_bytes=${aggregate('output_bytes', true)}, retained_staging_bytes=${aggregate('staging_bytes', true)} WHERE id=1;
  UPDATE accepted_attempts SET hold_bytes=${DISK_HOLD_METADATA_BYTES} WHERE attempt_id IN (SELECT attempt_id FROM disk_holds);`;

export const holdGuards = `
  CREATE TRIGGER disk_stats_insert BEFORE INSERT ON disk_retention_stats
    BEGIN SELECT RAISE(ABORT,'immutable retention singleton'); END;
  CREATE TRIGGER disk_stats_delete BEFORE DELETE ON disk_retention_stats
    BEGIN SELECT RAISE(ABORT,'immutable retention singleton'); END;
  CREATE TRIGGER disk_stats_update BEFORE UPDATE ON disk_retention_stats WHEN NOT(${statsMatch})
    BEGIN SELECT RAISE(ABORT,'incorrect retention counters'); END;
  CREATE TRIGGER disk_hold_insert BEFORE INSERT ON disk_holds BEGIN
    SELECT CASE WHEN EXISTS(SELECT 1 FROM disk_holds WHERE attempt_id=NEW.attempt_id)
      THEN RAISE(ABORT,'immutable disk hold') END;
    SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM reservations r JOIN accepted_attempts a USING(attempt_id)
      WHERE r.attempt_id=NEW.attempt_id AND a.organization_id=NEW.organization_id AND a.workspace_id=NEW.workspace_id
      AND a.generation=NEW.generation AND a.intent_digest=NEW.intent_digest
      AND NEW.output_bytes=json_extract(r.reservation_json,'$.resources.outputBytes')
      AND NEW.staging_bytes=json_extract(r.reservation_json,'$.resources.stagingBytes')
      AND NEW.phase=CASE r.charged WHEN 1 THEN 'active' ELSE 'retained' END)
      THEN RAISE(ABORT,'inconsistent disk hold') END;
  END;
  CREATE TRIGGER disk_hold_inserted AFTER INSERT ON disk_holds BEGIN
    ${updateStats}
    UPDATE accepted_attempts SET hold_bytes=NEW.metadata_bytes WHERE attempt_id=NEW.attempt_id;
  END;
  CREATE TRIGGER disk_hold_delete BEFORE DELETE ON disk_holds
    BEGIN SELECT RAISE(ABORT,'immutable disk hold'); END;
  CREATE TRIGGER disk_hold_update BEFORE UPDATE ON disk_holds BEGIN
    SELECT CASE WHEN NEW.attempt_id IS NOT OLD.attempt_id OR NEW.organization_id IS NOT OLD.organization_id
      OR NEW.workspace_id IS NOT OLD.workspace_id OR NEW.generation IS NOT OLD.generation
      OR NEW.intent_digest IS NOT OLD.intent_digest OR NEW.output_bytes IS NOT OLD.output_bytes
      OR NEW.staging_bytes IS NOT OLD.staging_bytes OR NEW.metadata_bytes IS NOT OLD.metadata_bytes
      OR OLD.phase!='active' OR NEW.phase!='retained'
      OR NOT EXISTS(SELECT 1 FROM reservations WHERE attempt_id=NEW.attempt_id AND charged=0)
      THEN RAISE(ABORT,'immutable disk hold') END;
  END;
  CREATE TRIGGER disk_hold_updated AFTER UPDATE ON disk_holds BEGIN ${updateStats} END;
`;

export const populate = `INSERT INTO disk_holds
  SELECT r.attempt_id,a.organization_id,a.workspace_id,a.generation,a.intent_digest,
    json_extract(r.reservation_json,'$.resources.outputBytes'),json_extract(r.reservation_json,'$.resources.stagingBytes'),
    ${DISK_HOLD_METADATA_BYTES},CASE r.charged WHEN 1 THEN 'active' ELSE 'retained' END
  FROM reservations r JOIN accepted_attempts a USING(attempt_id);`;

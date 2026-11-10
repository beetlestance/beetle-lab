import { EVENT_MAX_RETAINED_BYTES, EVENT_MAX_RETAINED_ROWS, EVENT_RECORD_BYTES,
  EVENT_ROW_ALLOWANCE } from '../../../domain/events/index.js';

/** Durable contiguous events remain pending independently of CPU/RAM release. */
export const migration007 = `
ALTER TABLE execution_records ADD COLUMN event_pending INTEGER NOT NULL DEFAULT 1 CHECK(event_pending IN (0,1));
CREATE INDEX execution_event_pending ON execution_records(queue_order,attempt_id)
 WHERE acknowledged_generation=1 AND event_pending=1;
CREATE UNIQUE INDEX execution_event_binding ON execution_records
 (attempt_id,run_id,organization_id,workspace_id,intent_digest,journal_authority,acknowledged_generation);
CREATE TRIGGER execution_event_pending_retained BEFORE UPDATE OF event_pending ON execution_records
 WHEN NEW.event_pending IS NOT OLD.event_pending
 BEGIN SELECT RAISE(ABORT,'event closure requires finalization authority'); END;
CREATE TABLE event_cursors (
 attempt_id TEXT PRIMARY KEY,run_id TEXT NOT NULL,organization_id TEXT NOT NULL,workspace_id TEXT NOT NULL,
 intent_digest TEXT NOT NULL,journal_authority TEXT NOT NULL,generation INTEGER NOT NULL CHECK(generation=1),
 durable_through INTEGER NOT NULL DEFAULT 0 CHECK(typeof(durable_through)='integer' AND durable_through BETWEEN 0 AND ${EVENT_MAX_RETAINED_ROWS}),
 ack_confirmed_through INTEGER NOT NULL DEFAULT 0 CHECK(typeof(ack_confirmed_through)='integer' AND ack_confirmed_through BETWEEN 0 AND durable_through),
 event_count INTEGER NOT NULL DEFAULT 0 CHECK(typeof(event_count)='integer' AND event_count BETWEEN 0 AND ${EVENT_MAX_RETAINED_ROWS} AND event_count=durable_through),
 retained_bytes INTEGER NOT NULL DEFAULT 0 CHECK(typeof(retained_bytes)='integer' AND retained_bytes BETWEEN 0 AND ${EVENT_MAX_RETAINED_BYTES}),
 coverage TEXT NOT NULL DEFAULT 'contiguous' CHECK(coverage IN ('contiguous','partial')),
 blocked_reason TEXT CHECK(blocked_reason IN ('cursor_expired','quota_exhausted','missing_receipt','replay_conflict')),
 retained_start_seq INTEGER CHECK(retained_start_seq IS NULL OR (typeof(retained_start_seq)='integer' AND retained_start_seq BETWEEN 0 AND 9007199254740991)),
 CHECK((blocked_reason IS 'cursor_expired' AND retained_start_seq IS NOT NULL AND coverage='partial'
        AND retained_start_seq>durable_through AND retained_start_seq-durable_through>1) OR
       (blocked_reason IS NOT 'cursor_expired' AND retained_start_seq IS NULL AND coverage='contiguous')),
 UNIQUE(attempt_id,generation),
 FOREIGN KEY(attempt_id,run_id,organization_id,workspace_id,intent_digest,journal_authority,generation)
 REFERENCES execution_records(attempt_id,run_id,organization_id,workspace_id,intent_digest,journal_authority,acknowledged_generation));
CREATE TABLE run_events (
 attempt_id TEXT NOT NULL,generation INTEGER NOT NULL CHECK(generation=1),
 seq INTEGER NOT NULL CHECK(typeof(seq)='integer' AND seq BETWEEN 1 AND ${EVENT_MAX_RETAINED_ROWS}),
 canonical_json TEXT NOT NULL CHECK(typeof(canonical_json)='text' AND json_valid(canonical_json)
   AND length(CAST(canonical_json AS BLOB))<=${EVENT_RECORD_BYTES}),
 charged_bytes INTEGER NOT NULL CHECK(typeof(charged_bytes)='integer'
   AND charged_bytes=length(CAST(canonical_json AS BLOB))+${EVENT_ROW_ALLOWANCE}),
 cumulative_bytes INTEGER NOT NULL CHECK(typeof(cumulative_bytes)='integer' AND cumulative_bytes BETWEEN charged_bytes AND ${EVENT_MAX_RETAINED_BYTES}),
 PRIMARY KEY(attempt_id,generation,seq),
 FOREIGN KEY(attempt_id,generation) REFERENCES event_cursors(attempt_id,generation)
) WITHOUT ROWID;
CREATE TRIGGER event_cursor_insert BEFORE INSERT ON event_cursors BEGIN
 SELECT CASE WHEN EXISTS(SELECT 1 FROM event_cursors WHERE attempt_id=NEW.attempt_id)
 THEN RAISE(ABORT,'retained event cursor') END;
 SELECT CASE WHEN NEW.durable_through!=0 OR NEW.ack_confirmed_through!=0 OR NEW.event_count!=0 OR NEW.retained_bytes!=0
  OR NEW.coverage!='contiguous' OR NEW.blocked_reason IS NOT NULL OR NEW.retained_start_seq IS NOT NULL
 THEN RAISE(ABORT,'new event cursor requires zero authority') END;
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM execution_records e JOIN attempt_output_allocations a ON a.attempt_id=e.attempt_id
  WHERE e.attempt_id=NEW.attempt_id AND e.run_id=NEW.run_id AND e.organization_id=NEW.organization_id
   AND e.workspace_id=NEW.workspace_id AND e.intent_digest=NEW.intent_digest AND e.journal_authority=NEW.journal_authority
   AND e.acknowledged_generation=NEW.generation AND e.event_pending=1
   AND a.run_id=e.run_id AND a.organization_id=e.organization_id AND a.workspace_id=e.workspace_id)
 THEN RAISE(ABORT,'event cursor requires retained original') END; END;
CREATE TRIGGER event_cursor_update BEFORE UPDATE ON event_cursors BEGIN
 SELECT CASE WHEN NEW.attempt_id IS NOT OLD.attempt_id OR NEW.run_id IS NOT OLD.run_id
  OR NEW.organization_id IS NOT OLD.organization_id OR NEW.workspace_id IS NOT OLD.workspace_id
  OR NEW.intent_digest IS NOT OLD.intent_digest OR NEW.journal_authority IS NOT OLD.journal_authority
  OR NEW.generation IS NOT OLD.generation
 THEN RAISE(ABORT,'immutable event binding') END;
 SELECT CASE WHEN NEW.durable_through<OLD.durable_through OR NEW.ack_confirmed_through<OLD.ack_confirmed_through
  OR NEW.event_count<OLD.event_count OR NEW.retained_bytes<OLD.retained_bytes
  OR (OLD.blocked_reason IS NOT NULL AND NEW.blocked_reason IS NOT OLD.blocked_reason)
  OR (OLD.retained_start_seq IS NOT NULL AND NEW.retained_start_seq IS NOT OLD.retained_start_seq)
  OR (OLD.coverage='partial' AND NEW.coverage!='partial')
 THEN RAISE(ABORT,'monotonic event custody') END;
 SELECT CASE WHEN (NEW.event_count!=OLD.event_count OR NEW.retained_bytes!=OLD.retained_bytes)
  AND (NEW.event_count!=OLD.event_count+1 OR NOT EXISTS(SELECT 1 FROM run_events r
   WHERE r.attempt_id=NEW.attempt_id AND r.generation=NEW.generation AND r.seq=NEW.event_count
    AND r.cumulative_bytes=NEW.retained_bytes AND r.charged_bytes=NEW.retained_bytes-OLD.retained_bytes))
 THEN RAISE(ABORT,'event counters require immutable row') END;
 SELECT CASE WHEN NEW.durable_through!=OLD.durable_through AND NEW.durable_through!=NEW.event_count
 THEN RAISE(ABORT,'durable event prefix requires complete append') END; END;
CREATE TRIGGER event_cursor_retained BEFORE DELETE ON event_cursors
 BEGIN SELECT RAISE(ABORT,'retained event cursor'); END;
CREATE TRIGGER run_event_insert BEFORE INSERT ON run_events BEGIN
 SELECT CASE WHEN EXISTS(SELECT 1 FROM run_events WHERE attempt_id=NEW.attempt_id AND generation=NEW.generation AND seq=NEW.seq)
 THEN RAISE(ABORT,'retained event record') END;
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM event_cursors c JOIN attempt_output_allocations a ON a.attempt_id=c.attempt_id
  WHERE c.attempt_id=NEW.attempt_id AND c.generation=NEW.generation AND c.blocked_reason IS NULL
   AND c.event_count<${EVENT_MAX_RETAINED_ROWS} AND NEW.seq=c.event_count+1
   AND NEW.cumulative_bytes=c.retained_bytes+NEW.charged_bytes
   AND NEW.cumulative_bytes<=min(a.maximum_payload_bytes,${EVENT_MAX_RETAINED_BYTES})
   AND json_type(NEW.canonical_json)='object' AND json_type(NEW.canonical_json,'$.seq')='integer'
   AND json_extract(NEW.canonical_json,'$.seq')=NEW.seq
   AND json_extract(NEW.canonical_json,'$.generation')=NEW.generation
   AND json_extract(NEW.canonical_json,'$.attemptId')=c.attempt_id
   AND json_extract(NEW.canonical_json,'$.organizationId')=c.organization_id
   AND json_extract(NEW.canonical_json,'$.workspaceId')=c.workspace_id)
 THEN RAISE(ABORT,'event append requires contiguous owned allowance') END; END;
CREATE TRIGGER run_event_count AFTER INSERT ON run_events BEGIN
 UPDATE event_cursors SET event_count=NEW.seq,durable_through=NEW.seq,retained_bytes=NEW.cumulative_bytes
 WHERE attempt_id=NEW.attempt_id AND generation=NEW.generation; END;
CREATE TRIGGER run_event_immutable BEFORE UPDATE ON run_events
 BEGIN SELECT RAISE(ABORT,'immutable event record'); END;
CREATE TRIGGER run_event_retained BEFORE DELETE ON run_events
 BEGIN SELECT RAISE(ABORT,'retained event record'); END;
PRAGMA user_version=7;
`;

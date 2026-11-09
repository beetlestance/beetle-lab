import { RUNNER_MAXIMUM_OFFER_BYTES } from '@beetle/contracts';
import { AGENT_EVENT_BYTES } from '../control-protocol/index.js';

/** Rebuild the complete direct FK graph without disabling enforcement. */
export const migration008 = `
  CREATE TEMP TABLE migration008_identity AS
    SELECT name,seq FROM sqlite_sequence WHERE name IN ('accepted_attempts','admission_queue','reservations');
  CREATE TABLE accepted_attempts_v8 (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    attempt_id TEXT NOT NULL UNIQUE, organization_id TEXT NOT NULL, workspace_id TEXT NOT NULL,
    intent_digest TEXT NOT NULL, generation INTEGER NOT NULL CHECK(generation=1),
    state TEXT NOT NULL CHECK(state IN ('offered','admitted','preparing','running','stopping','collecting','exited','lost')),
    last_seq INTEGER NOT NULL CHECK(last_seq BETWEEN 0 AND 9007199254740990),
    cancel_requested INTEGER NOT NULL DEFAULT 0 CHECK(cancel_requested IN (0,1)),
    offer_json TEXT NOT NULL CHECK(length(CAST(offer_json AS BLOB))<=${RUNNER_MAXIMUM_OFFER_BYTES}),
    canonical_json TEXT NOT NULL CHECK(length(CAST(canonical_json AS BLOB))<=${RUNNER_MAXIMUM_OFFER_BYTES}),
    retained_start_seq INTEGER NOT NULL DEFAULT 0 CHECK(retained_start_seq>=0),
    acknowledged_seq INTEGER NOT NULL DEFAULT 0 CHECK(acknowledged_seq BETWEEN 0 AND last_seq),
    spool_bytes INTEGER NOT NULL DEFAULT 0 CHECK(spool_bytes BETWEEN 0 AND quota_bytes),
    spool_rows INTEGER NOT NULL DEFAULT 0 CHECK(spool_rows BETWEEN 0 AND 65536),
    quota_bytes INTEGER NOT NULL DEFAULT 67108864 CHECK(quota_bytes BETWEEN 1024 AND 67108864),
    wrapper_high INTEGER NOT NULL DEFAULT 0, supervisor_high INTEGER NOT NULL DEFAULT 0,
    wrapper_expired INTEGER NOT NULL DEFAULT 0, supervisor_expired INTEGER NOT NULL DEFAULT 0,
    phase TEXT CHECK(phase IN ('validate','prepare','execute','collect','seal')),
    exit_json TEXT CHECK(length(CAST(exit_json AS BLOB))<=1024),
    exit_facts_json TEXT CHECK(length(CAST(exit_facts_json AS BLOB))<=1024),
    result_json TEXT CHECK(length(CAST(result_json AS BLOB))<=65536),
    snapshot_bytes INTEGER NOT NULL DEFAULT 0
      CHECK(snapshot_bytes BETWEEN 0 AND 67592 AND snapshot_bytes+spool_bytes<=quota_bytes),
    wrapper_checkpoint_json TEXT CHECK(length(CAST(wrapper_checkpoint_json AS BLOB))<=1024),
    checkpoint_bytes INTEGER NOT NULL DEFAULT 0 CHECK(checkpoint_bytes BETWEEN 0 AND 1024
      AND checkpoint_bytes=COALESCE(length(CAST(wrapper_checkpoint_json AS BLOB)),0)
      AND checkpoint_bytes+snapshot_bytes+spool_bytes<=quota_bytes)
  );
  CREATE TABLE event_spool_v8 (
    attempt_id TEXT NOT NULL REFERENCES accepted_attempts_v8(attempt_id),
    generation INTEGER NOT NULL CHECK(generation=1), seq INTEGER NOT NULL CHECK(seq>0),
    source TEXT NOT NULL CHECK(source IN ('wrapper','agent')),
    source_key INTEGER NOT NULL CHECK(source_key BETWEEN 1 AND 9007199254740991),
    canonical_json TEXT NOT NULL CHECK(length(CAST(canonical_json AS BLOB))<=65536),
    event_json TEXT NOT NULL CHECK(length(CAST(event_json AS BLOB))<=${AGENT_EVENT_BYTES}),
    encoded_bytes INTEGER NOT NULL CHECK(encoded_bytes BETWEEN 1 AND ${AGENT_EVENT_BYTES}),
    charged_bytes INTEGER NOT NULL CHECK(charged_bytes=encoded_bytes+length(CAST(canonical_json AS BLOB))+256),
    PRIMARY KEY(attempt_id,generation,seq), UNIQUE(attempt_id,generation,source,source_key)
  );
  CREATE TABLE admission_queue_v8 (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    attempt_id TEXT NOT NULL UNIQUE REFERENCES accepted_attempts_v8(attempt_id),
    candidate_json TEXT NOT NULL CHECK(length(CAST(candidate_json AS BLOB))<=16384),
    decision_json TEXT CHECK(length(CAST(decision_json AS BLOB))<=512),
    pending INTEGER NOT NULL DEFAULT 1 CHECK(pending IN (0,1))
  );
  CREATE TABLE reservations_v8 (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    attempt_id TEXT NOT NULL UNIQUE REFERENCES accepted_attempts_v8(attempt_id),
    reservation_json TEXT NOT NULL CHECK(length(CAST(reservation_json AS BLOB))<=32768),
    charged INTEGER NOT NULL CHECK(charged IN (0,1))
  );
  CREATE TABLE supervision_clock_v8 (
    attempt_id TEXT PRIMARY KEY REFERENCES accepted_attempts_v8(attempt_id),
    high_water INTEGER NOT NULL CHECK(high_water BETWEEN 0 AND 9007199254740991),
    fenced INTEGER NOT NULL CHECK(fenced IN (0,1)),
    cancel_at INTEGER CHECK(cancel_at BETWEEN 0 AND high_water),
    cancel_reason TEXT CHECK(cancel_reason IN ('cancelled','timeout','output_limit','artifact_incomplete','clock_integrity')),
    stop_immediate INTEGER NOT NULL DEFAULT 0 CHECK(stop_immediate IN (0,1))
  );
  INSERT INTO accepted_attempts_v8 (id,attempt_id,organization_id,workspace_id,intent_digest,generation,state,
    last_seq,cancel_requested,offer_json,canonical_json,retained_start_seq,acknowledged_seq,spool_bytes,
    spool_rows,quota_bytes,wrapper_high,supervisor_high,wrapper_expired,supervisor_expired,phase,exit_json,
    exit_facts_json,result_json,snapshot_bytes,wrapper_checkpoint_json,checkpoint_bytes)
    SELECT id,attempt_id,organization_id,workspace_id,intent_digest,generation,state,
      last_seq,cancel_requested,offer_json,canonical_json,retained_start_seq,acknowledged_seq,spool_bytes,
      spool_rows,quota_bytes,wrapper_high,supervisor_high,wrapper_expired,supervisor_expired,phase,exit_json,
      exit_facts_json,result_json,snapshot_bytes,wrapper_checkpoint_json,checkpoint_bytes FROM accepted_attempts;
  INSERT INTO event_spool_v8 (attempt_id,generation,seq,source,source_key,canonical_json,event_json,encoded_bytes,charged_bytes)
    SELECT attempt_id,generation,seq,source,source_key,canonical_json,event_json,encoded_bytes,charged_bytes FROM event_spool;
  INSERT INTO admission_queue_v8 (id,attempt_id,candidate_json,decision_json,pending)
    SELECT id,attempt_id,candidate_json,decision_json,pending FROM admission_queue;
  INSERT INTO reservations_v8 (id,attempt_id,reservation_json,charged)
    SELECT id,attempt_id,reservation_json,charged FROM reservations;
  INSERT INTO supervision_clock_v8 (attempt_id,high_water,fenced,cancel_at,cancel_reason,stop_immediate)
    SELECT attempt_id,high_water,fenced,cancel_at,cancel_reason,stop_immediate FROM supervision_clock;
  DROP TABLE event_spool;
  DROP TABLE admission_queue;
  DROP TABLE reservations;
  DROP TABLE supervision_clock;
  DROP TABLE accepted_attempts;
  ALTER TABLE accepted_attempts_v8 RENAME TO accepted_attempts;
  ALTER TABLE event_spool_v8 RENAME TO event_spool;
  ALTER TABLE admission_queue_v8 RENAME TO admission_queue;
  ALTER TABLE reservations_v8 RENAME TO reservations;
  ALTER TABLE supervision_clock_v8 RENAME TO supervision_clock;
  UPDATE sqlite_sequence SET seq=MAX(seq,COALESCE((SELECT seq FROM migration008_identity WHERE name=sqlite_sequence.name),0))
    WHERE name IN ('accepted_attempts','admission_queue','reservations');
  INSERT INTO sqlite_sequence(name,seq) SELECT name,seq FROM migration008_identity
    WHERE name NOT IN (SELECT name FROM sqlite_sequence);
  DROP TABLE migration008_identity;
  CREATE INDEX admission_pending ON admission_queue(pending,id);
  CREATE INDEX reservation_charged ON reservations(charged,id);
  PRAGMA user_version=8;
`;

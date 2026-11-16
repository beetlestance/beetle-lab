// Both sides of the FK are rebuilt in SQL. Foreign-key enforcement stays enabled.
export const migration003 = `
  CREATE TEMP TABLE migration003_identity AS SELECT seq FROM sqlite_sequence WHERE name='accepted_attempts';
  CREATE TABLE accepted_attempts_v3 (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    attempt_id TEXT NOT NULL UNIQUE, organization_id TEXT NOT NULL, workspace_id TEXT NOT NULL,
    intent_digest TEXT NOT NULL, generation INTEGER NOT NULL CHECK(generation=1),
    state TEXT NOT NULL CHECK(state IN ('offered','admitted','preparing','running','stopping','collecting','exited','lost')),
    last_seq INTEGER NOT NULL CHECK(last_seq BETWEEN 0 AND 9007199254740990),
    cancel_requested INTEGER NOT NULL DEFAULT 0 CHECK(cancel_requested IN (0,1)),
    offer_json TEXT NOT NULL CHECK(length(CAST(offer_json AS BLOB))<=1048576),
    canonical_json TEXT NOT NULL CHECK(length(CAST(canonical_json AS BLOB))<=1048576),
    retained_start_seq INTEGER NOT NULL DEFAULT 0 CHECK(retained_start_seq>=0),
    acknowledged_seq INTEGER NOT NULL DEFAULT 0 CHECK(acknowledged_seq BETWEEN 0 AND last_seq),
    spool_bytes INTEGER NOT NULL DEFAULT 0 CHECK(spool_bytes BETWEEN 0 AND quota_bytes),
    spool_rows INTEGER NOT NULL DEFAULT 0 CHECK(spool_rows BETWEEN 0 AND 65536),
    quota_bytes INTEGER NOT NULL DEFAULT 67108864 CHECK(quota_bytes BETWEEN 1024 AND 67108864),
    wrapper_high INTEGER NOT NULL DEFAULT 0, supervisor_high INTEGER NOT NULL DEFAULT 0,
    wrapper_expired INTEGER NOT NULL DEFAULT 0, supervisor_expired INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE event_spool_v3 (
    attempt_id TEXT NOT NULL REFERENCES accepted_attempts_v3(attempt_id),
    generation INTEGER NOT NULL CHECK(generation=1), seq INTEGER NOT NULL CHECK(seq>0),
    source TEXT NOT NULL CHECK(source IN ('wrapper','agent')),
    source_key INTEGER NOT NULL CHECK(source_key BETWEEN 1 AND 9007199254740991),
    canonical_json TEXT NOT NULL CHECK(length(CAST(canonical_json AS BLOB))<=65536),
    event_json TEXT NOT NULL CHECK(length(CAST(event_json AS BLOB))<=65536),
    encoded_bytes INTEGER NOT NULL CHECK(encoded_bytes BETWEEN 1 AND 65536),
    charged_bytes INTEGER NOT NULL CHECK(charged_bytes=encoded_bytes+length(CAST(canonical_json AS BLOB))+256),
    PRIMARY KEY(attempt_id,generation,seq), UNIQUE(attempt_id,generation,source,source_key)
  );
  INSERT INTO accepted_attempts_v3 SELECT * FROM accepted_attempts;
  INSERT INTO event_spool_v3 SELECT * FROM event_spool;
  DROP TABLE event_spool;
  DROP TABLE accepted_attempts;
  ALTER TABLE accepted_attempts_v3 RENAME TO accepted_attempts;
  ALTER TABLE event_spool_v3 RENAME TO event_spool;
  UPDATE sqlite_sequence SET seq=MAX(seq,COALESCE((SELECT seq FROM migration003_identity),0)) WHERE name='accepted_attempts';
  DROP TABLE migration003_identity;
  CREATE TABLE admission_settings (
    id INTEGER PRIMARY KEY CHECK(id=1),
    configuration_json TEXT CHECK(length(CAST(configuration_json AS BLOB))<=65536),
    observation_json TEXT CHECK(length(CAST(observation_json AS BLOB))<=65536),
    last_clock INTEGER NOT NULL DEFAULT 0 CHECK(last_clock>=0)
  );
  INSERT INTO admission_settings(id) VALUES (1);
  CREATE TABLE admission_queue (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    attempt_id TEXT NOT NULL UNIQUE REFERENCES accepted_attempts(attempt_id),
    candidate_json TEXT NOT NULL CHECK(length(CAST(candidate_json AS BLOB))<=16384),
    decision_json TEXT CHECK(length(CAST(decision_json AS BLOB))<=512),
    pending INTEGER NOT NULL DEFAULT 1 CHECK(pending IN (0,1))
  );
  CREATE INDEX admission_pending ON admission_queue(pending,id);
  CREATE TABLE reservations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    attempt_id TEXT NOT NULL UNIQUE REFERENCES accepted_attempts(attempt_id),
    reservation_json TEXT NOT NULL CHECK(length(CAST(reservation_json AS BLOB))<=32768),
    charged INTEGER NOT NULL CHECK(charged IN (0,1))
  );
  CREATE INDEX reservation_charged ON reservations(charged,id);
  PRAGMA user_version=3;
`;

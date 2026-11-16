import { AGENT_EVENT_BYTES } from '../control-protocol/index.js';

/** Checkpoint custody plus enrichment room beyond the bounded producer frame. */
export const migration006 = `
  ALTER TABLE accepted_attempts ADD COLUMN wrapper_checkpoint_json TEXT
    CHECK(length(CAST(wrapper_checkpoint_json AS BLOB))<=1024);
  ALTER TABLE accepted_attempts ADD COLUMN checkpoint_bytes INTEGER NOT NULL DEFAULT 0
    CHECK(checkpoint_bytes BETWEEN 0 AND 1024
      AND checkpoint_bytes=COALESCE(length(CAST(wrapper_checkpoint_json AS BLOB)),0)
      AND checkpoint_bytes+snapshot_bytes+spool_bytes<=quota_bytes);
  CREATE TABLE event_spool_v6 (
    attempt_id TEXT NOT NULL REFERENCES accepted_attempts(attempt_id),
    generation INTEGER NOT NULL CHECK(generation=1), seq INTEGER NOT NULL CHECK(seq>0),
    source TEXT NOT NULL CHECK(source IN ('wrapper','agent')),
    source_key INTEGER NOT NULL CHECK(source_key BETWEEN 1 AND 9007199254740991),
    canonical_json TEXT NOT NULL CHECK(length(CAST(canonical_json AS BLOB))<=65536),
    event_json TEXT NOT NULL CHECK(length(CAST(event_json AS BLOB))<=${AGENT_EVENT_BYTES}),
    encoded_bytes INTEGER NOT NULL CHECK(encoded_bytes BETWEEN 1 AND ${AGENT_EVENT_BYTES}),
    charged_bytes INTEGER NOT NULL CHECK(charged_bytes=encoded_bytes+length(CAST(canonical_json AS BLOB))+256),
    PRIMARY KEY(attempt_id,generation,seq), UNIQUE(attempt_id,generation,source,source_key)
  );
  INSERT INTO event_spool_v6 SELECT * FROM event_spool;
  DROP TABLE event_spool;
  ALTER TABLE event_spool_v6 RENAME TO event_spool;
  PRAGMA user_version=6;
`;

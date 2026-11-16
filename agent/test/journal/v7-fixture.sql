-- Independent, literal version-seven database; never import migration SQL here.
PRAGMA foreign_keys=ON;
CREATE TABLE accepted_attempts (
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
  wrapper_expired INTEGER NOT NULL DEFAULT 0, supervisor_expired INTEGER NOT NULL DEFAULT 0,
  phase TEXT CHECK(phase IN ('validate','prepare','execute','collect','seal')),
  exit_json TEXT CHECK(length(CAST(exit_json AS BLOB))<=1024),
  exit_facts_json TEXT CHECK(length(CAST(exit_facts_json AS BLOB))<=1024),
  result_json TEXT CHECK(length(CAST(result_json AS BLOB))<=65536),
  snapshot_bytes INTEGER NOT NULL DEFAULT 0 CHECK(snapshot_bytes BETWEEN 0 AND 67592 AND snapshot_bytes+spool_bytes<=quota_bytes),
  wrapper_checkpoint_json TEXT CHECK(length(CAST(wrapper_checkpoint_json AS BLOB))<=1024),
  checkpoint_bytes INTEGER NOT NULL DEFAULT 0 CHECK(checkpoint_bytes BETWEEN 0 AND 1024
    AND checkpoint_bytes=COALESCE(length(CAST(wrapper_checkpoint_json AS BLOB)),0)
    AND checkpoint_bytes+snapshot_bytes+spool_bytes<=quota_bytes)
);
CREATE TABLE event_spool (
  attempt_id TEXT NOT NULL REFERENCES accepted_attempts(attempt_id),
  generation INTEGER NOT NULL CHECK(generation=1), seq INTEGER NOT NULL CHECK(seq>0),
  source TEXT NOT NULL CHECK(source IN ('wrapper','agent')),
  source_key INTEGER NOT NULL CHECK(source_key BETWEEN 1 AND 9007199254740991),
  canonical_json TEXT NOT NULL CHECK(length(CAST(canonical_json AS BLOB))<=65536),
  event_json TEXT NOT NULL CHECK(length(CAST(event_json AS BLOB))<=66048),
  encoded_bytes INTEGER NOT NULL CHECK(encoded_bytes BETWEEN 1 AND 66048),
  charged_bytes INTEGER NOT NULL CHECK(charged_bytes=encoded_bytes+length(CAST(canonical_json AS BLOB))+256),
  PRIMARY KEY(attempt_id,generation,seq), UNIQUE(attempt_id,generation,source,source_key)
);
CREATE TABLE admission_settings (
  id INTEGER PRIMARY KEY CHECK(id=1), configuration_json TEXT CHECK(length(CAST(configuration_json AS BLOB))<=65536),
  observation_json TEXT CHECK(length(CAST(observation_json AS BLOB))<=65536),
  last_clock INTEGER NOT NULL DEFAULT 0 CHECK(last_clock>=0)
);
CREATE TABLE admission_queue (
  id INTEGER PRIMARY KEY AUTOINCREMENT, attempt_id TEXT NOT NULL UNIQUE REFERENCES accepted_attempts(attempt_id),
  candidate_json TEXT NOT NULL CHECK(length(CAST(candidate_json AS BLOB))<=16384),
  decision_json TEXT CHECK(length(CAST(decision_json AS BLOB))<=512),
  pending INTEGER NOT NULL DEFAULT 1 CHECK(pending IN (0,1))
);
CREATE INDEX admission_pending ON admission_queue(pending,id);
CREATE TABLE reservations (
  id INTEGER PRIMARY KEY AUTOINCREMENT, attempt_id TEXT NOT NULL UNIQUE REFERENCES accepted_attempts(attempt_id),
  reservation_json TEXT NOT NULL CHECK(length(CAST(reservation_json AS BLOB))<=32768),
  charged INTEGER NOT NULL CHECK(charged IN (0,1))
);
CREATE INDEX reservation_charged ON reservations(charged,id);
CREATE TABLE supervision_clock (
  attempt_id TEXT PRIMARY KEY REFERENCES accepted_attempts(attempt_id),
  high_water INTEGER NOT NULL CHECK(high_water BETWEEN 0 AND 9007199254740991),
  fenced INTEGER NOT NULL CHECK(fenced IN (0,1)), cancel_at INTEGER CHECK(cancel_at BETWEEN 0 AND high_water),
  cancel_reason TEXT CHECK(cancel_reason IN ('cancelled','timeout','output_limit','artifact_incomplete','clock_integrity')),
  stop_immediate INTEGER NOT NULL DEFAULT 0 CHECK(stop_immediate IN (0,1))
);
INSERT INTO accepted_attempts VALUES
  (17,'Attempt-UPPER','Org-UPPER','Workspace-UPPER','intent',1,'collecting',9,1,' {"old":true} ','{"old":true}',
   4,8,260,1,4096,19,23,3,4,'collect','{"exit":null}','{"known":0}','{"result":true}',30,'{"cursor":7}',12);
INSERT INTO event_spool VALUES ('Attempt-UPPER',1,9,'agent',23,'{}','{}',2,260);
INSERT INTO admission_queue VALUES (29,'Attempt-UPPER','{"staging":{"policyVersion":1,"totalBytes":133333}}','{"kind":"admit"}',0);
INSERT INTO reservations VALUES (37,'Attempt-UPPER','{"charged":133333,"staging":{"policyVersion":1}}',1);
INSERT INTO supervision_clock VALUES ('Attempt-UPPER',999,1,888,'output_limit',1);
INSERT INTO admission_settings VALUES (1,' {"preserve":true} ','{"obsolete":true}',777);
UPDATE sqlite_sequence SET seq=101 WHERE name='accepted_attempts';
UPDATE sqlite_sequence SET seq=202 WHERE name='admission_queue';
UPDATE sqlite_sequence SET seq=303 WHERE name='reservations';
PRAGMA user_version=7;

const safe = (name: string, minimum = 1) => `${name} INTEGER NOT NULL CHECK(typeof(${name})='integer' AND ${name} BETWEEN ${minimum} AND 9007199254740991)`;
/** Compact enqueue facts and retained execution ownership; no history backfill. */
export const executionSchema = `
ALTER TABLE attempts ADD COLUMN foundation_owned INTEGER NOT NULL DEFAULT 0 CHECK(foundation_owned IN (0,1));
ALTER TABLE attempts ADD COLUMN execution_intent_id TEXT REFERENCES execution_intents(attempt_id);
ALTER TABLE dispatch_outbox ADD COLUMN execution_intent_id TEXT REFERENCES execution_intents(attempt_id);
CREATE INDEX attempts_untracked_ownership ON attempts(generation,id) WHERE execution_intent_id IS NULL AND generation IS NOT NULL;
CREATE INDEX outbox_untracked_ownership ON dispatch_outbox(attempt_id) WHERE execution_intent_id IS NULL AND possible_delivery=1;
CREATE UNIQUE INDEX outbox_delivery_identity ON dispatch_outbox(attempt_id,possible_delivery);
CREATE TABLE execution_intents (
 queue_order INTEGER PRIMARY KEY AUTOINCREMENT CHECK(queue_order BETWEEN 1 AND 9007199254740991),
 attempt_id TEXT NOT NULL UNIQUE, run_id TEXT NOT NULL, organization_id TEXT NOT NULL, workspace_id TEXT NOT NULL,
 intent_digest TEXT NOT NULL, profile_alias TEXT NOT NULL CHECK(length(profile_alias) BETWEEN 1 AND 128),
 registry_digest TEXT NOT NULL CHECK(length(registry_digest)=64 AND registry_digest NOT GLOB '*[^0-9a-f]*'),
 ${['cpu_millis','memory_bytes','pids','timeout_ms','output_bytes'].map(name => safe(name)).join(',\n ')},
 mode TEXT NOT NULL CHECK(mode IN ('parallel','isolated')), prefer_idle INTEGER NOT NULL CHECK(prefer_idle IN (0,1)),
 staging_policy INTEGER NOT NULL CHECK(staging_policy=1),
 ${['offer_bytes','input_bytes','secret_bytes','manifest_bytes','metadata_bytes','staging_bytes'].map(name => safe(name,0)).join(',\n ')},
 CHECK(offer_bytes BETWEEN 1 AND 2097152 AND secret_bytes<=1048576 AND manifest_bytes=65536 AND metadata_bytes=65536),
 CHECK(input_bytes<=9007199254740991-offer_bytes-secret_bytes-manifest_bytes-metadata_bytes),
 CHECK(staging_bytes=offer_bytes+input_bytes+secret_bytes+manifest_bytes+metadata_bytes),
 UNIQUE(attempt_id,queue_order), UNIQUE(attempt_id,run_id,organization_id,workspace_id,intent_digest),
 FOREIGN KEY(attempt_id,run_id,organization_id,workspace_id) REFERENCES attempts(id,run_id,organization_id,workspace_id),
 FOREIGN KEY(attempt_id,intent_digest) REFERENCES attempts(id,intent_digest));
CREATE TABLE execution_records (
 attempt_id TEXT PRIMARY KEY, queue_order INTEGER NOT NULL, run_id TEXT NOT NULL,
 organization_id TEXT NOT NULL, workspace_id TEXT NOT NULL, intent_digest TEXT NOT NULL,
 execution_charged INTEGER NOT NULL DEFAULT 1 CHECK(execution_charged IN (0,1)),
 acknowledged_generation INTEGER CHECK(acknowledged_generation IS NULL OR acknowledged_generation=1),
 snapshot_json TEXT CHECK(snapshot_json IS NULL OR (json_valid(snapshot_json) AND length(CAST(snapshot_json AS BLOB))<=73728)),
 delivery_attempt_id TEXT, delivery_possible INTEGER NOT NULL DEFAULT 1 CHECK(delivery_possible=1),
 output_attempt_id TEXT NOT NULL CHECK(output_attempt_id=attempt_id),
 CHECK(delivery_attempt_id IS NULL OR delivery_attempt_id=attempt_id),
 CHECK((acknowledged_generation IS NULL AND snapshot_json IS NULL AND delivery_attempt_id IS NOT NULL) OR
       (acknowledged_generation=1 AND snapshot_json IS NOT NULL)),
 UNIQUE(attempt_id,run_id,organization_id,workspace_id),
 FOREIGN KEY(attempt_id,queue_order) REFERENCES execution_intents(attempt_id,queue_order),
 FOREIGN KEY(attempt_id,run_id,organization_id,workspace_id,intent_digest)
 REFERENCES execution_intents(attempt_id,run_id,organization_id,workspace_id,intent_digest),
 FOREIGN KEY(delivery_attempt_id,delivery_possible) REFERENCES dispatch_outbox(attempt_id,possible_delivery) DEFERRABLE INITIALLY DEFERRED,
 FOREIGN KEY(output_attempt_id) REFERENCES attempt_output_allocations(attempt_id) DEFERRABLE INITIALLY DEFERRED);
CREATE INDEX execution_charged ON execution_records(queue_order) WHERE execution_charged=1;
CREATE TABLE attempt_output_allocations (
 attempt_id TEXT PRIMARY KEY, run_id TEXT NOT NULL, organization_id TEXT NOT NULL, workspace_id TEXT NOT NULL,
 ${safe('maximum_payload_bytes')}, metadata_bytes INTEGER NOT NULL CHECK(metadata_bytes=65536),
 ${safe('charged_bytes')}, ${safe('version')},
 CHECK(maximum_payload_bytes<=9007199254740991-metadata_bytes AND charged_bytes=maximum_payload_bytes+metadata_bytes),
 FOREIGN KEY(attempt_id,run_id,organization_id,workspace_id)
 REFERENCES execution_records(attempt_id,run_id,organization_id,workspace_id) DEFERRABLE INITIALLY DEFERRED);
`;

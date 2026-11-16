import {EXPORT_ASSIGNMENT_BYTES} from '@beetle/contracts';
export const EXPORT_METADATA_BYTES=3*1048576;
const safe=(name:string,minimum=0)=>`${name} INTEGER NOT NULL CHECK(typeof(${name})='integer' AND ${name} BETWEEN ${minimum} AND 9007199254740991)`;
export const exportSchema=`
CREATE TABLE export_jobs (
 id TEXT PRIMARY KEY CHECK(id=lower(id)),organization_id TEXT NOT NULL,workspace_id TEXT NOT NULL,
 suite_id TEXT NOT NULL,revision_id TEXT NOT NULL,attempt_id TEXT NOT NULL UNIQUE,queue_order INTEGER NOT NULL UNIQUE,
 original_id TEXT NOT NULL CHECK(original_id=id),
 intent_digest TEXT NOT NULL CHECK(length(intent_digest)=64 AND intent_digest NOT GLOB '*[^0-9a-f]*'),
 input_count INTEGER NOT NULL CHECK(typeof(input_count)='integer' AND input_count BETWEEN 0 AND 64),
 source_profile TEXT NOT NULL,registry_digest TEXT NOT NULL CHECK(length(registry_digest)=64 AND registry_digest NOT GLOB '*[^0-9a-f]*'),
 assignment_digest TEXT NOT NULL CHECK(length(assignment_digest)=64 AND assignment_digest NOT GLOB '*[^0-9a-f]*'),
 intent_json TEXT NOT NULL CHECK(json_valid(intent_json) AND length(CAST(intent_json AS BLOB)) BETWEEN 1 AND 32768),
 ${['cpu_millis','memory_bytes','pids','timeout_ms','output_bytes','staging_bytes'].map(name=>safe(name,1)).join(',\n ')},
 mode TEXT NOT NULL CHECK(mode IN ('parallel','isolated')),
 maximum_build_bytes INTEGER NOT NULL CHECK(typeof(maximum_build_bytes)='integer' AND maximum_build_bytes BETWEEN 1 AND 67108864),
 version INTEGER NOT NULL CHECK(typeof(version)='integer' AND version BETWEEN 1 AND 9007199254740991),
 state TEXT NOT NULL CHECK(state IN ('queued','dispatching','generating','publishing','ready','failed','cancelled','unknown')),
 cancellation_requested INTEGER NOT NULL DEFAULT 0 CHECK(cancellation_requested IN (0,1)),reason TEXT,
 possible_delivery INTEGER NOT NULL DEFAULT 0 CHECK(possible_delivery IN (0,1)),
 execution_charged INTEGER NOT NULL DEFAULT 0 CHECK(execution_charged IN (0,1)),
 journal_authority TEXT CHECK(journal_authority IS NULL OR (length(journal_authority)=36 AND journal_authority=lower(journal_authority))),
 snapshot_json TEXT CHECK(snapshot_json IS NULL OR (json_valid(snapshot_json) AND length(CAST(snapshot_json AS BLOB))<=32768)),
 metadata_charged INTEGER NOT NULL DEFAULT ${EXPORT_METADATA_BYTES} CHECK(metadata_charged=${EXPORT_METADATA_BYTES}),
 ${safe('output_charged')},
 CHECK(output_charged<=maximum_build_bytes),CHECK(execution_charged=0 OR possible_delivery=1),
 CHECK(possible_delivery=0 OR journal_authority IS NOT NULL),
 CHECK(output_bytes>=maximum_build_bytes+73728),
 CHECK(json_extract(intent_json,'$.id') IS id AND json_extract(intent_json,'$.activeAttemptId') IS attempt_id),
 CHECK(json_extract(intent_json,'$.scope.organizationId') IS organization_id AND json_extract(intent_json,'$.scope.workspaceId') IS workspace_id),
 CHECK(json_extract(intent_json,'$.revisionId') IS revision_id AND json_extract(intent_json,'$.suiteId') IS suite_id),
 CHECK(json_extract(intent_json,'$.sourceProfileId') IS source_profile),
 CHECK(json_extract(intent_json,'$.budget.cpuMillis') IS cpu_millis AND json_extract(intent_json,'$.budget.memoryBytes') IS memory_bytes),
 CHECK(json_extract(intent_json,'$.budget.pids') IS pids AND json_extract(intent_json,'$.budget.timeoutMs') IS timeout_ms),
 CHECK(json_extract(intent_json,'$.budget.outputBytes') IS output_bytes),
 CHECK(json_extract(intent_json,'$.executionPolicy.mode') IS mode),
 CHECK(json_extract(intent_json,'$.options.maximumBuildBytes') IS maximum_build_bytes),
 UNIQUE(id,organization_id,workspace_id),UNIQUE(id,assignment_digest),
 FOREIGN KEY(revision_id,suite_id,organization_id,workspace_id) REFERENCES suite_revisions(id,suite_id,organization_id,workspace_id),
 FOREIGN KEY(queue_order) REFERENCES execution_orders(queue_order),
 FOREIGN KEY(original_id) REFERENCES export_originals(export_id) DEFERRABLE INITIALLY DEFERRED);
CREATE INDEX exports_page ON export_jobs(organization_id,workspace_id,id);
CREATE INDEX exports_pending ON export_jobs(queue_order) WHERE state IN ('queued','dispatching','generating','publishing','unknown');
CREATE INDEX exports_charged ON export_jobs(queue_order) WHERE execution_charged=1;
CREATE TABLE export_originals (
 export_id TEXT PRIMARY KEY,assignment_digest TEXT NOT NULL,
 assignment_json TEXT NOT NULL CHECK(json_valid(assignment_json) AND length(CAST(assignment_json AS BLOB)) BETWEEN 1 AND ${EXPORT_ASSIGNMENT_BYTES}),
 profile_json TEXT NOT NULL CHECK(json_valid(profile_json) AND length(CAST(profile_json AS BLOB)) BETWEEN 1 AND 32768),
 FOREIGN KEY(export_id,assignment_digest) REFERENCES export_jobs(id,assignment_digest));
CREATE TABLE export_input_pins (
 export_id TEXT NOT NULL,organization_id TEXT NOT NULL,workspace_id TEXT NOT NULL,input_id TEXT NOT NULL,
 sha256 TEXT NOT NULL,bytes INTEGER NOT NULL,PRIMARY KEY(export_id,input_id),
 FOREIGN KEY(export_id,organization_id,workspace_id) REFERENCES export_jobs(id,organization_id,workspace_id),
 FOREIGN KEY(organization_id,workspace_id,input_id) REFERENCES input_blobs(organization_id,workspace_id,id));
CREATE TABLE export_sources (
 export_id TEXT PRIMARY KEY,assignment_digest TEXT NOT NULL,
 manifest_digest TEXT NOT NULL CHECK(length(manifest_digest)=64 AND manifest_digest NOT GLOB '*[^0-9a-f]*'),
 source_digest TEXT NOT NULL CHECK(length(source_digest)=64 AND source_digest NOT GLOB '*[^0-9a-f]*'),
 source_json TEXT NOT NULL CHECK(json_valid(source_json) AND length(CAST(source_json AS BLOB))<=75776),
 final_agent_seq INTEGER NOT NULL CHECK(typeof(final_agent_seq)='integer' AND final_agent_seq BETWEEN 0 AND 65536),
 FOREIGN KEY(export_id,assignment_digest) REFERENCES export_jobs(id,assignment_digest));
CREATE TABLE export_absences (
 export_id TEXT PRIMARY KEY REFERENCES export_jobs(id),proof_digest TEXT NOT NULL,
 proof_json TEXT NOT NULL CHECK(length(CAST(proof_json AS BLOB))<=2048 AND json_valid(proof_json)),
 CHECK(output_absence_digest(proof_json) IS proof_digest));
CREATE TABLE export_artifacts (
 export_id TEXT PRIMARY KEY REFERENCES export_sources(export_id),artifact_id TEXT NOT NULL,token TEXT NOT NULL UNIQUE,
 bytes INTEGER NOT NULL CHECK(typeof(bytes)='integer' AND bytes BETWEEN 1 AND 67108864),
 sha256 TEXT NOT NULL CHECK(length(sha256)=64 AND sha256 NOT GLOB '*[^0-9a-f]*'),
 ${safe('offset')},
 phase TEXT NOT NULL CHECK(phase IN ('transferring','publishing','published')),
 identity TEXT CHECK(identity IS NULL OR (length(identity)=64 AND identity NOT GLOB '*[^0-9a-f]*')),
 writer TEXT CHECK(writer IS NULL OR length(writer)=36),${safe('version',1)},
 CHECK(offset<=bytes),CHECK(phase='transferring' OR (offset=bytes AND identity IS NOT NULL)),
 CHECK(phase!='publishing' OR writer IS NOT NULL),CHECK(phase!='published' OR writer IS NULL));
`;

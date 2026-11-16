import { boundedUniqueJson } from './output-payloads/index.js';
const uuid = (path: string) => `(length(${path})=36 AND ${path}=lower(${path}) AND substr(${path},9,1)='-' AND substr(${path},14,1)='-' AND substr(${path},19,1)='-' AND substr(${path},24,1)='-' AND length(replace(${path},'-',''))=32 AND replace(${path},'-','') NOT GLOB '*[^0-9a-f]*')`;
const digest = (path: string) => `(length(${path})=64 AND ${path} NOT GLOB '*[^0-9a-f]*')`;
export const migration009 = `
ALTER TABLE execution_records ADD COLUMN output_pending INTEGER NOT NULL DEFAULT 1 CHECK(output_pending=1);
CREATE INDEX execution_output_pending ON execution_records(queue_order,attempt_id)
 WHERE acknowledged_generation=1 AND output_pending=1;
CREATE TABLE execution_output_sources (
 attempt_id TEXT PRIMARY KEY,run_id TEXT NOT NULL,organization_id TEXT NOT NULL,workspace_id TEXT NOT NULL,
 intent_digest TEXT NOT NULL,journal_authority TEXT NOT NULL,generation INTEGER NOT NULL CHECK(generation=1),
 version INTEGER NOT NULL CHECK(typeof(version)='integer' AND version=1),
 source_digest TEXT NOT NULL CHECK(${digest('source_digest')}),
 manifest_digest TEXT NOT NULL CHECK(${digest('manifest_digest')}),
 final_agent_seq INTEGER NOT NULL CHECK(typeof(final_agent_seq)='integer' AND final_agent_seq BETWEEN 0 AND 9007199254740991),
 closure_json TEXT NOT NULL,
 FOREIGN KEY(attempt_id,run_id,organization_id,workspace_id,intent_digest,journal_authority,generation)
 REFERENCES execution_records(attempt_id,run_id,organization_id,workspace_id,intent_digest,journal_authority,acknowledged_generation));
CREATE TABLE execution_output_slots (
 attempt_id TEXT NOT NULL REFERENCES execution_output_sources(attempt_id),
 ordinal INTEGER NOT NULL CHECK(typeof(ordinal)='integer' AND ordinal BETWEEN 0 AND 127),
 slot_json TEXT NOT NULL, PRIMARY KEY(attempt_id,ordinal));
CREATE UNIQUE INDEX output_slot_token ON execution_output_slots(attempt_id,json_extract(slot_json,'$.t'));
CREATE TRIGGER output_source_insert BEFORE INSERT ON execution_output_sources BEGIN
 SELECT CASE WHEN ${boundedUniqueJson('outputClosure')} IS NOT 1 THEN RAISE(ABORT,'invalid output closure') END;
 SELECT CASE WHEN EXISTS(SELECT 1 FROM execution_output_sources WHERE attempt_id=NEW.attempt_id)
 OR json_type(NEW.closure_json) IS NOT 'object' OR (SELECT count(*) FROM json_each(NEW.closure_json))!=3
 OR EXISTS(SELECT 1 FROM json_each(NEW.closure_json) WHERE key NOT IN ('version','receipt','finalAgentSeq'))
 OR json_type(NEW.closure_json,'$.version') IS NOT 'integer' OR json_extract(NEW.closure_json,'$.version') IS NOT 1
 OR json_type(NEW.closure_json,'$.finalAgentSeq') IS NOT 'integer'
 OR json_extract(NEW.closure_json,'$.finalAgentSeq') IS NOT NEW.final_agent_seq
 OR json_type(NEW.closure_json,'$.receipt') IS NOT 'object'
 OR (SELECT count(*) FROM json_each(NEW.closure_json,'$.receipt'))!=5
 OR EXISTS(SELECT 1 FROM json_each(NEW.closure_json,'$.receipt') WHERE key NOT IN ('version','key','journalAuthority','manifestDigest','sourceDigest'))
 THEN RAISE(ABORT,'closed output closure') END;
 SELECT CASE WHEN json_extract(NEW.closure_json,'$.receipt.version') IS NOT 1
 OR json_type(NEW.closure_json,'$.receipt.version') IS NOT 'integer'
 OR json_extract(NEW.closure_json,'$.receipt.journalAuthority') IS NOT NEW.journal_authority
 OR json_extract(NEW.closure_json,'$.receipt.manifestDigest') IS NOT NEW.manifest_digest
 OR json_extract(NEW.closure_json,'$.receipt.sourceDigest') IS NOT NEW.source_digest
 OR json_type(NEW.closure_json,'$.receipt.key') IS NOT 'object'
 OR (SELECT count(*) FROM json_each(NEW.closure_json,'$.receipt.key'))!=4
 OR json_extract(NEW.closure_json,'$.receipt.key.organizationId') IS NOT NEW.organization_id
 OR json_extract(NEW.closure_json,'$.receipt.key.workspaceId') IS NOT NEW.workspace_id
 OR json_extract(NEW.closure_json,'$.receipt.key.attemptId') IS NOT NEW.attempt_id
 OR json_type(NEW.closure_json,'$.receipt.key.generation') IS NOT 'integer'
 OR json_extract(NEW.closure_json,'$.receipt.key.generation') IS NOT 1
 THEN RAISE(ABORT,'closure binding') END;
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM execution_output_payloads p WHERE p.attempt_id=NEW.attempt_id
 AND p.kind='manifest' AND json_extract(p.canonical_json,'$.manifestDigest')=NEW.manifest_digest)
 OR coalesce((SELECT durable_through FROM event_cursors WHERE attempt_id=NEW.attempt_id),0)>NEW.final_agent_seq
 OR coalesce((SELECT max(seq) FROM run_events WHERE attempt_id=NEW.attempt_id),0)>NEW.final_agent_seq
 THEN RAISE(ABORT,'output source requires carrier and event end') END; END;
CREATE TRIGGER output_source_immutable BEFORE UPDATE ON execution_output_sources
 BEGIN SELECT RAISE(ABORT,'immutable output source'); END;
CREATE TRIGGER output_source_retained BEFORE DELETE ON execution_output_sources
 BEGIN SELECT RAISE(ABORT,'retained output source'); END;
CREATE TRIGGER output_slot_insert BEFORE INSERT ON execution_output_slots BEGIN
 SELECT CASE WHEN ${boundedUniqueJson('outputSlot')} IS NOT 1 THEN RAISE(ABORT,'invalid output slot') END;
 SELECT CASE WHEN json_type(NEW.slot_json) IS NOT 'object' OR (SELECT count(*) FROM json_each(NEW.slot_json))!=6
 OR EXISTS(SELECT 1 FROM json_each(NEW.slot_json) WHERE key NOT IN ('v','t','o','p','i','w'))
 OR json_type(NEW.slot_json,'$.v') IS NOT 'integer' OR json_extract(NEW.slot_json,'$.v') IS NOT 1
 OR json_type(NEW.slot_json,'$.o') IS NOT 'integer' OR json_extract(NEW.slot_json,'$.o') IS NOT 0
 OR json_extract(NEW.slot_json,'$.p') IS NOT 'transferring'
 OR json_type(NEW.slot_json,'$.i') IS NOT 'null' OR json_type(NEW.slot_json,'$.w') IS NOT 'null'
 OR json_type(NEW.slot_json,'$.t') IS NOT 'text' OR NOT ${uuid("json_extract(NEW.slot_json,'$.t')")}
 OR EXISTS(SELECT 1 FROM execution_output_slots WHERE attempt_id=NEW.attempt_id AND ordinal=NEW.ordinal)
 OR NOT EXISTS(SELECT 1 FROM execution_output_payloads p WHERE p.attempt_id=NEW.attempt_id AND p.kind='manifest'
 AND NEW.ordinal<json_array_length(p.canonical_json,'$.result.artifacts'))
 THEN RAISE(ABORT,'closed initial output slot') END; END;
CREATE TRIGGER output_slot_immutable BEFORE UPDATE ON execution_output_slots
 BEGIN SELECT RAISE(ABORT,'writer authority pending'); END;
CREATE TRIGGER output_slot_retained BEFORE DELETE ON execution_output_slots
 BEGIN SELECT RAISE(ABORT,'retained output slot'); END;
CREATE TRIGGER output_event_end BEFORE INSERT ON run_events WHEN EXISTS(
 SELECT 1 FROM execution_output_sources WHERE attempt_id=NEW.attempt_id AND NEW.seq>final_agent_seq)
 BEGIN SELECT RAISE(ABORT,'immutable output event end'); END;
PRAGMA user_version=9;
`;

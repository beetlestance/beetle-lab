const immutable = (table: string, prefix: string): string => `
  CREATE TRIGGER ${prefix}_insert BEFORE INSERT ON ${table}
    WHEN EXISTS(SELECT 1 FROM ${table} WHERE attempt_id=NEW.attempt_id)
    BEGIN SELECT RAISE(ABORT,'immutable output source'); END;
  CREATE TRIGGER ${prefix}_delete BEFORE DELETE ON ${table}
    BEGIN SELECT RAISE(ABORT,'immutable output source'); END;`;
const pinned = ['organizationId', 'workspaceId', 'attemptId', 'generation', 'intentDigest'];
const parentNames = ['organization_id', 'workspace_id', 'attempt_id', 'generation', 'intent_digest'];
const bindingMatches = pinned.map((name, index) => `json_extract(NEW.intent_json,'$.binding.${name}') IS a.${parentNames[index]}`).join(' AND ');
const intentTimes = ['begunAt', 'runtime.observedAt', 'launch.settledAt'].map(name =>
  `json_type(NEW.intent_json,'$.${name}')='integer' AND json_extract(NEW.intent_json,'$.${name}') BETWEEN 0 AND ${name === 'launch.settledAt' ? 8_640_000_000_000_000 : Number.MAX_SAFE_INTEGER}`).join(' AND ');
function jsonEqual(left: string, right: string): string {
  const values = (input: string) => `SELECT fullkey,type,atom FROM json_tree(${input})`;
  return `(NOT EXISTS(${values(left)} EXCEPT ${values(right)}) AND NOT EXISTS(${values(right)} EXCEPT ${values(left)}))`;
}
function releaseRelation(release: string, intent: string): string {
  const scope = ['organizationId', 'workspaceId', 'attemptId', 'generation'].map(name =>
    `json_extract(${release},'$.key.${name}') IS json_extract(${intent},'$.binding.${name}')`);
  const binding = ['createToken', 'specDigest', 'runtimeId'].map(name =>
    `json_extract(${release},'$.${name}') IS json_extract(${intent},'$.launch.${name}')`);
  const launch = ['epoch', 'startToken'].map(name =>
    `json_extract(${release},'$.launch.${name}') IS json_extract(${intent},'$.launch.${name}')`);
  return [`json_extract(${release},'$.authority')='supervisor'`,
    `json_extract(${release},'$.runtime.state')='stopped'`, `json_extract(${release},'$.runtime.source')='supervisor'`,
    ...scope, ...binding, ...launch,
    `json_extract(${release},'$.launch.settlementId') IS json_extract(${intent},'$.launch.evidenceId')`,
    `json_type(${release},'$.collection.observedAt')='integer'`,
    `json_extract(${release},'$.collection.observedAt') BETWEEN 0 AND ${Number.MAX_SAFE_INTEGER}`,
    `json_extract(${release},'$.collection.observedAt')>=json_extract(${intent},'$.begunAt')`,
    jsonEqual(`json_extract(${release},'$.runtime')`, `json_extract(${intent},'$.runtime')`)].join(' AND ');
}

export const outputSourceGuards = `
  ${immutable('output_collection_intents', 'output_intent')}
  ${immutable('output_sources', 'output_source')}
  CREATE TRIGGER output_intent_validate BEFORE INSERT ON output_collection_intents BEGIN
    SELECT CASE WHEN NEW.phase!='pending' OR NOT EXISTS(
      SELECT 1 FROM accepted_attempts a JOIN reservations r USING(attempt_id) JOIN disk_holds h USING(attempt_id)
      WHERE a.attempt_id=NEW.attempt_id AND r.charged=1 AND h.phase='active' AND ${bindingMatches}
        AND json_extract(NEW.intent_json,'$.binding.journalAuthority')=(SELECT authority FROM journal_authority WHERE id=1)
        AND json_extract(NEW.intent_json,'$.collectionId')=NEW.collection_id
        AND json_extract(NEW.intent_json,'$.runtime.state')='stopped' AND json_extract(NEW.intent_json,'$.runtime.source')='supervisor'
        AND ${intentTimes}
        AND json_extract(NEW.intent_json,'$.begunAt')>=json_extract(NEW.intent_json,'$.runtime.observedAt')
        AND json_extract(NEW.intent_json,'$.runtime.observedAt')>json_extract(NEW.intent_json,'$.launch.settledAt')
        AND a.result_json IS NOT NULL AND json_extract(NEW.intent_json,'$.checkpoint.wrapperSeq')=a.wrapper_high
        AND json_extract(NEW.intent_json,'$.binding.specDigest')=json_extract(r.reservation_json,'$.specDigest')
        AND ${jsonEqual("json_extract(NEW.intent_json,'$.launch')", "json_extract(r.reservation_json,'$.launchSettlement')")}
        AND ${jsonEqual("json_extract(NEW.intent_json,'$.checkpoint')", 'a.wrapper_checkpoint_json')}
        AND ${jsonEqual("json_extract(NEW.intent_json,'$.binding.engine')", "json_extract(a.offer_json,'$.engine')")}
        AND ${jsonEqual("json_extract(NEW.intent_json,'$.binding.installedIdentity')", "json_extract(a.offer_json,'$.installedIdentity')")})
      THEN RAISE(ABORT,'invalid output intent') END;
  END;
  CREATE TRIGGER output_intent_inserted AFTER INSERT ON output_collection_intents BEGIN
    UPDATE accepted_attempts SET collection_bytes=NEW.charged_bytes WHERE attempt_id=NEW.attempt_id;
  END;
  CREATE TRIGGER output_intent_update BEFORE UPDATE ON output_collection_intents BEGIN
    SELECT CASE WHEN NEW.attempt_id IS NOT OLD.attempt_id OR NEW.collection_id IS NOT OLD.collection_id
      OR NEW.intent_json IS NOT OLD.intent_json OR NEW.charged_bytes IS NOT OLD.charged_bytes OR NEW.created_epoch IS NOT OLD.created_epoch
      OR OLD.phase!='pending' OR NOT(
        (NEW.phase='sourced' AND EXISTS(SELECT 1 FROM output_sources WHERE attempt_id=OLD.attempt_id))
        OR (NEW.phase='failed' AND NOT EXISTS(SELECT 1 FROM output_sources WHERE attempt_id=OLD.attempt_id)
          AND EXISTS(SELECT 1 FROM reservations WHERE attempt_id=OLD.attempt_id AND charged=0
            AND json_extract(reservation_json,'$.releaseEvidence.collection.state')='failed'
            AND json_extract(reservation_json,'$.releaseEvidence.collection.evidenceId')=OLD.collection_id)))
      THEN RAISE(ABORT,'immutable output intent') END;
  END;
  CREATE TRIGGER output_source_validate BEFORE INSERT ON output_sources BEGIN
    SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM output_collection_intents i JOIN reservations r USING(attempt_id)
      JOIN accepted_attempts a USING(attempt_id) WHERE i.attempt_id=NEW.attempt_id AND i.phase='pending' AND r.charged=1
        AND json_extract(NEW.source_json,'$.release.collection.state')='finished'
        AND json_extract(NEW.source_json,'$.manifest.binding')=json_extract(i.intent_json,'$.binding')
        AND json_extract(NEW.source_json,'$.root')=json_extract(i.intent_json,'$.root')
        AND json_extract(NEW.source_json,'$.checkpoint')=json_extract(i.intent_json,'$.checkpoint')
        AND ${jsonEqual("json_extract(NEW.source_json,'$.manifest.result')", 'a.result_json')}
        AND json_extract(NEW.source_json,'$.release.collection.evidenceId')=i.collection_id
        AND json_extract(NEW.source_json,'$.manifest.controlBytes')=json_extract(i.intent_json,'$.checkpoint.offset')
        AND json_extract(NEW.source_json,'$.manifest.verifiedBytes')<=json_extract(r.reservation_json,'$.resources.outputBytes')
        AND ${releaseRelation("json_extract(NEW.source_json,'$.release')", 'i.intent_json')}
        AND json_extract(NEW.source_json,'$.manifest.manifestDigest')=NEW.manifest_digest
        AND json_extract(NEW.source_json,'$.sourceDigest')=NEW.source_digest)
      THEN RAISE(ABORT,'invalid output source') END;
  END;
  CREATE TRIGGER output_source_update BEFORE UPDATE ON output_sources
    BEGIN SELECT RAISE(ABORT,'immutable output source'); END;
  CREATE TRIGGER output_source_inserted AFTER INSERT ON output_sources BEGIN
    UPDATE accepted_attempts SET source_bytes=NEW.charged_bytes WHERE attempt_id=NEW.attempt_id;
    UPDATE output_collection_intents SET phase='sourced' WHERE attempt_id=NEW.attempt_id;
  END;
  CREATE TRIGGER output_reservation_update BEFORE UPDATE ON reservations
    WHEN EXISTS(SELECT 1 FROM output_collection_intents WHERE attempt_id=OLD.attempt_id) BEGIN
    SELECT CASE WHEN json_remove(NEW.reservation_json,'$.status','$.releaseEvidence') IS NOT json_remove(OLD.reservation_json,'$.status','$.releaseEvidence')
      OR (OLD.charged=0 AND NEW.reservation_json IS NOT OLD.reservation_json)
      THEN RAISE(ABORT,'immutable output reservation') END;
    SELECT CASE WHEN OLD.charged=1 AND NEW.charged=0 AND NOT EXISTS(
      SELECT 1 FROM output_collection_intents i WHERE i.attempt_id=OLD.attempt_id AND (
        (i.phase='sourced' AND EXISTS(SELECT 1 FROM output_sources s WHERE s.attempt_id=i.attempt_id
          AND json_extract(NEW.reservation_json,'$.releaseEvidence')=json_extract(s.source_json,'$.release')))
        OR (i.phase='pending' AND NOT EXISTS(SELECT 1 FROM output_sources WHERE attempt_id=i.attempt_id)
          AND json_extract(NEW.reservation_json,'$.releaseEvidence.collection.state')='failed'
          AND json_extract(NEW.reservation_json,'$.releaseEvidence.collection.evidenceId')=i.collection_id
          AND ${releaseRelation("json_extract(NEW.reservation_json,'$.releaseEvidence')", 'i.intent_json')})))
      THEN RAISE(ABORT,'output release proof required') END;
  END;
  CREATE TRIGGER output_reservation_released AFTER UPDATE OF charged ON reservations WHEN OLD.charged=1 AND NEW.charged=0 BEGIN
    UPDATE output_collection_intents SET phase='failed' WHERE attempt_id=NEW.attempt_id AND phase='pending'
      AND json_extract(NEW.reservation_json,'$.releaseEvidence.collection.state')='failed';
  END;
  CREATE TRIGGER output_finished_release BEFORE UPDATE OF charged ON reservations
    WHEN OLD.charged=1 AND NEW.charged=0 AND json_extract(NEW.reservation_json,'$.releaseEvidence.collection.state')='finished'
      AND NOT EXISTS(SELECT 1 FROM output_sources WHERE attempt_id=OLD.attempt_id)
    BEGIN SELECT RAISE(ABORT,'output source required'); END;
`;

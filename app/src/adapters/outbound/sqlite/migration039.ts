import { finalProjection } from './migration029.js';
import { headerGuards } from './output-payloads/guards.js';

const reasons = "('timeout','output_limit','artifact_incomplete','clock_integrity')";
const property = '$.systemStopReason';
const newReason = `json_extract(NEW.snapshot_json,'${property}')`;
const oldReason = `json_extract(OLD.snapshot_json,'${property}')`;
const knownReason = `json_extract(e.snapshot_json,'${property}')`;
const wrapper = "json_extract(e.snapshot_json,'$.exitEvidence.reason')";
const systemStop = `coalesce(${knownReason},CASE WHEN ${wrapper} IN ${reasons} THEN ${wrapper} END)`;

const proof = `json_type(e.snapshot_json,'${property}')`;
const stopReady = `${proof} IS NOT NULL AND json_extract(e.snapshot_json,'$.lastSeq') IS s.final_agent_seq`;
const projection = finalProjection
  .replace(' retained_payload_bytes,', ` retained_payload_bytes, (${stopReady}) stop_ready,`)
  .replace(
    "CASE WHEN json_extract(e.snapshot_json,'$.exitEvidence.oomKilled')=1 THEN 'errored'",
    `CASE WHEN NOT (${stopReady}) THEN NULL
  WHEN json_extract(e.snapshot_json,'$.exitEvidence.oomKilled')=1 THEN 'errored'`,
  )
  .replaceAll(`WHEN ${wrapper} IN ${reasons} THEN`, `WHEN ${systemStop} IS NOT NULL THEN`)
  .replace(`WHEN ${systemStop} IS NOT NULL THEN ${wrapper}`, `WHEN ${systemStop} IS NOT NULL THEN ${systemStop}`)
  .replace(
    'CASE WHEN r.cancellation_requested=0 AND',
    `CASE WHEN r.cancellation_requested=0 AND ${systemStop} IS NULL AND`,
  );

const headerUpdate = headerGuards
  .slice(headerGuards.indexOf('CREATE TRIGGER output_header_update'))
  .replace("'cancelRequested','exitEvidence'", "'cancelRequested','systemStopReason','exitEvidence'")
  .replace(
    ' SELECT CASE WHEN NEW.result_observed<',
    ` SELECT CASE WHEN json_type(NEW.snapshot_json,'${property}') IS NOT NULL AND (
  json_extract(NEW.snapshot_json,'$.admission.state') IS NOT 'released' OR
  json_extract(NEW.snapshot_json,'$.admission.disposition') IS NOT 'settled')
 THEN RAISE(ABORT,'system stop evidence requires settled delivery') END;
 SELECT CASE WHEN json_type(NEW.snapshot_json,'${property}') NOT IN ('null') AND (
  json_type(NEW.snapshot_json,'$.cancelRequested') IS NOT 'true' OR
  json_type(NEW.snapshot_json,'${property}') IS NOT 'text' OR ${newReason} NOT IN ${reasons})
 THEN RAISE(ABORT,'invalid system stop evidence') END;
 SELECT CASE WHEN json_type(OLD.snapshot_json,'${property}') IS NOT NULL AND (
  json_type(NEW.snapshot_json,'${property}') IS NOT json_type(OLD.snapshot_json,'${property}')
  OR ${newReason} IS NOT ${oldReason}
  OR json_extract(NEW.snapshot_json,'$.lastSeq') IS NOT json_extract(OLD.snapshot_json,'$.lastSeq'))
 THEN RAISE(ABORT,'immutable system stop evidence') END;
 SELECT CASE WHEN NEW.result_observed<`,
  );

export const migration039 = `
DROP VIEW output_finalization_evidence;
${projection}
DROP TRIGGER output_header_update;
${headerUpdate}
PRAGMA user_version=39;
`;

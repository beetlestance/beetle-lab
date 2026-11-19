import { absentProjection } from './migration029.js';

const reason = "json_extract(s.proof_json,'$.reason')";
const systemCause = `${reason} IN ('timeout','output_limit','artifact_incomplete','clock_integrity')`;
const physicalOom = `s.final_agent_seq>0
  AND json_extract(s.proof_json,'$.admission.state')='released'
  AND json_extract(s.proof_json,'$.admission.disposition')='settled'
  AND json_extract(e.snapshot_json,'$.state')='exited'
  AND json_type(e.snapshot_json,'$.exitEvidence.oomKilled')='true'`;

function replace(sql: string, prior: string, next: string): string {
  if (sql.split(prior).length !== 2) throw Error('Unexpected predecessor absence projection');
  return sql.replace(prior, next);
}

const state = replace(
  absentProjection,
  `CASE WHEN ${systemCause} THEN 'errored'`,
  `CASE WHEN ${physicalOom} THEN 'errored'
  WHEN ${systemCause} THEN 'errored'`,
);
const outcome = replace(
  state,
  `CASE WHEN ${systemCause} THEN ${reason}`,
  `CASE WHEN ${physicalOom} THEN 'memory_limit'
  WHEN ${systemCause} THEN ${reason}`,
);
const ready = replace(
  outcome,
  `AND (r.cancellation_requested=1 OR ${reason}!='cancelled') execution_ready`,
  `AND (r.cancellation_requested=1 OR ${reason}!='cancelled' OR (${physicalOom})) execution_ready`,
);

export const migration040 = `
DROP VIEW output_absence_evidence;
${ready}
PRAGMA user_version=40;
`;

import { absenceEvidence } from './output-absence/evidence.js';
import { absenceGuards } from './output-absence/guards.js';
const safe = (name: string, min = 0) => `${name} INTEGER NOT NULL CHECK(typeof(${name})='integer' AND ${name} BETWEEN ${min} AND 9007199254740991)`;
/** Sibling authority preserves the source receipt FK and original allocation. */
export const migration012 = `
CREATE TABLE execution_output_absences (
 attempt_id TEXT PRIMARY KEY,run_id TEXT NOT NULL,organization_id TEXT NOT NULL,workspace_id TEXT NOT NULL,
 intent_digest TEXT NOT NULL,journal_authority TEXT NOT NULL,generation INTEGER NOT NULL CHECK(generation=1),
 proof_digest TEXT NOT NULL CHECK(length(proof_digest)=64 AND proof_digest NOT GLOB '*[^0-9a-f]*'),
 ${safe('final_agent_seq')},proof_json TEXT NOT NULL CHECK(length(CAST(proof_json AS BLOB)) BETWEEN 1 AND 2048),
 UNIQUE(attempt_id,run_id,organization_id,workspace_id,intent_digest,journal_authority,generation,proof_digest,final_agent_seq),
 FOREIGN KEY(attempt_id,run_id,organization_id,workspace_id,intent_digest,journal_authority,generation)
 REFERENCES execution_records(attempt_id,run_id,organization_id,workspace_id,intent_digest,journal_authority,acknowledged_generation),
 FOREIGN KEY(attempt_id,run_id,organization_id,workspace_id)
 REFERENCES attempt_output_allocations(attempt_id,run_id,organization_id,workspace_id));
CREATE TABLE execution_output_absence_finalizations (
 attempt_id TEXT PRIMARY KEY,run_id TEXT NOT NULL,organization_id TEXT NOT NULL,workspace_id TEXT NOT NULL,
 intent_digest TEXT NOT NULL,journal_authority TEXT NOT NULL,generation INTEGER NOT NULL CHECK(generation=1),
 proof_digest TEXT NOT NULL,${safe('final_agent_seq')},${safe('retained_payload_bytes')},${safe('refunded_bytes')},${safe('run_version', 2)},
 state TEXT NOT NULL CHECK(state IN ('cancelled','errored')),outcome TEXT NOT NULL CHECK(outcome='inconclusive'),
 validation_status TEXT NOT NULL CHECK(validation_status='pending'),reason TEXT NOT NULL,
 FOREIGN KEY(attempt_id,run_id,organization_id,workspace_id,intent_digest,journal_authority,generation,proof_digest,final_agent_seq)
 REFERENCES execution_output_absences(attempt_id,run_id,organization_id,workspace_id,intent_digest,journal_authority,generation,proof_digest,final_agent_seq),
 FOREIGN KEY(attempt_id,run_id,organization_id,workspace_id)
 REFERENCES attempt_output_allocations(attempt_id,run_id,organization_id,workspace_id));
CREATE INDEX absence_finalization_run ON execution_output_absence_finalizations(run_id,attempt_id);
${absenceEvidence}
${absenceGuards}
PRAGMA user_version=12;
`;

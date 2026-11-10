import { finalizationEvidence } from './output-finalization/evidence.js';
import { finalizationGuards } from './output-finalization/guards.js';
const safe = (name: string, min = 0) => `${name} INTEGER NOT NULL CHECK(typeof(${name})='integer' AND ${name} BETWEEN ${min} AND 9007199254740991)`;
/** Credits preserve original allocations and their metadata charge. Any future
 * accounting reconstruction must subtract these immutable refunded_bytes.
 */
export const migration011 = `
CREATE UNIQUE INDEX output_source_finalization_binding ON execution_output_sources
 (attempt_id,run_id,organization_id,workspace_id,intent_digest,journal_authority,generation,source_digest,manifest_digest,final_agent_seq);
CREATE UNIQUE INDEX output_allocation_finalization_binding ON attempt_output_allocations(attempt_id,run_id,organization_id,workspace_id);
CREATE TABLE execution_output_finalizations (
 attempt_id TEXT PRIMARY KEY,run_id TEXT NOT NULL,organization_id TEXT NOT NULL,workspace_id TEXT NOT NULL,
 intent_digest TEXT NOT NULL,journal_authority TEXT NOT NULL,generation INTEGER NOT NULL CHECK(generation=1),
 source_digest TEXT NOT NULL,manifest_digest TEXT NOT NULL,${safe('final_agent_seq')},
 ${safe('retained_payload_bytes')},${safe('refunded_bytes')},${safe('run_version', 2)},
 state TEXT NOT NULL CHECK(state IN ('finished','cancelled','errored')),
 outcome TEXT NOT NULL CHECK(outcome IN ('passed','failed','inconclusive')),
 validation_status TEXT NOT NULL CHECK(validation_status IN ('pending','passed','failed')),reason TEXT,
 FOREIGN KEY(attempt_id,run_id,organization_id,workspace_id,intent_digest,journal_authority,generation,source_digest,manifest_digest,final_agent_seq)
 REFERENCES execution_output_sources(attempt_id,run_id,organization_id,workspace_id,intent_digest,journal_authority,generation,source_digest,manifest_digest,final_agent_seq),
 FOREIGN KEY(attempt_id,run_id,organization_id,workspace_id)
 REFERENCES attempt_output_allocations(attempt_id,run_id,organization_id,workspace_id));
CREATE INDEX finalization_run_binding ON execution_output_finalizations(run_id,attempt_id);
${finalizationEvidence}
${finalizationGuards}
PRAGMA user_version=11;
`;

import { createHash } from 'node:crypto';
import { namespaceMarkerBytes } from '../../../../agent/src/staging-namespace/index.js';
import assert from 'node:assert/strict';
import type { DatabaseSync } from 'node:sqlite';
import type { Run } from '@beetle/contracts/api';
import { runtimeName } from '../../../../agent/src/backends/docker/index.js';
import { counter, record } from '../../resources/values.js';
const metadata = [
  'spool_bytes',
  'snapshot_bytes',
  'checkpoint_bytes',
  'hold_bytes',
  'collection_bytes',
  'source_bytes',
  'delivery_bytes',
  'absence_bytes',
  'cleanup_control_bytes',
];
export function agent(db: DatabaseSync, runs: readonly Run[], installationId: string) {
  for (const table of ['accepted_attempts', 'reservations', 'disk_holds', 'task_staging_namespaces'])
    assert.equal(db.prepare(`SELECT COUNT(*) n FROM ${table}`).get()!.n, 4, table);
  for (const table of ['agent_replay_storage', 'rejected_cleanup_storage'])
    assert.equal(db.prepare(`SELECT charged_bytes FROM ${table} WHERE id=1`).get()!.charged_bytes, 0, table);
  const holds = [];
  let output = 0;
  let staging = 0;
  let journalMetadata = 0;
  for (const run of runs) {
    const row = record(
      db
        .prepare(
          `SELECT h.*,r.charged,n.runtime_name,n.state namespace_state,a.state,a.quota_bytes,${metadata.map((name) => 'a.' + name).join(',')}
   FROM disk_holds h JOIN reservations r USING(attempt_id) JOIN accepted_attempts a USING(attempt_id)
   JOIN task_staging_namespaces n USING(attempt_id) WHERE h.attempt_id=? AND h.organization_id=? AND h.workspace_id=?`,
        )
        .get(run.activeAttemptId, run.scope.organizationId, run.scope.workspaceId),
    );
    assert.equal(row.phase, 'retained');
    assert.equal(row.charged, 0);
    assert.equal(row.state, 'exited');
    assert.equal(row.generation, 1);
    assert.equal(row.output_bytes, 8388608);
    assert.equal(row.namespace_state, 'prepared');
    const name = runtimeName({
      installationId,
      organizationId: run.scope.organizationId,
      workspaceId: run.scope.workspaceId,
      attemptId: run.activeAttemptId,
      generation: 1,
    });
    assert.equal(row.runtime_name, name);
    const metadataBytes = metadata.reduce((sum, key) => sum + counter(row[key]), 0);
    assert(metadataBytes <= counter(row.quota_bytes));
    journalMetadata += metadataBytes;
    output += counter(row.output_bytes);
    staging += counter(row.staging_bytes);
    holds.push({
      attemptId: run.activeAttemptId,
      runtimeName: name,
      outputBytes: counter(row.output_bytes),
      stagingBytes: counter(row.staging_bytes),
      journalMetadataBytes: metadataBytes,
    });
  }
  const stats = record(db.prepare('SELECT * FROM disk_retention_stats WHERE id=1').get());
  assert.equal(stats.held_count, 4);
  assert.equal(stats.held_output_bytes, output);
  assert.equal(stats.retained_output_bytes, output);
  assert.equal(stats.held_staging_bytes, staging);
  assert.equal(stats.retained_staging_bytes, staging);
  const namespace = record(db.prepare('SELECT intent_json,state FROM installed_staging_namespace WHERE id=1').get());
  assert.equal(namespace.state, 'bound');
  assert(typeof namespace.intent_json === 'string' && namespace.intent_json.length <= 8192);
  const marker = namespaceMarkerBytes(JSON.parse(namespace.intent_json));
  return {
    marker: { bytes: marker.length, sha256: createHash('sha256').update(marker).digest('hex') },
    holds,
    currentRetainedOutputBytes: output,
    currentRetainedStagingBytes: staging,
    journalMetadataBytes: journalMetadata,
    executionCharged: 0,
  };
}

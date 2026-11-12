import assert from 'node:assert/strict';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { Run, RunResultSnapshot } from '@beetle/contracts/api';
import type { Fixture } from '../../../agent/test/container/fixture.js';
import type { Inspection } from '../../../agent/test/container/docker.js';

/** Cancellation releases execution, independently of sealed output publication. */
export function inspectCancelled(f: Fixture, run: Run, result: RunResultSnapshot) {
  assert.equal(run.state, 'cancelled'); assert.equal(run.outcome, 'inconclusive');
  assert.equal(result.result, null, 'Unsealed cancellation path only');
  const db = new DatabaseSync(join(f.root, 'backend/metadata.sqlite'), {readOnly: true});
  try {
    db.exec('PRAGMA query_only=ON; PRAGMA busy_timeout=1000;');
    const rows = db.prepare('SELECT execution_charged,event_pending,snapshot_json FROM execution_records WHERE attempt_id=? LIMIT 2').all(run.activeAttemptId);
    assert.equal(rows.length, 1); const execution = rows[0]!;
    assert.equal(execution.execution_charged, 0); assert.equal(execution.event_pending, 0);
    assert(typeof execution.snapshot_json === 'string' && Buffer.byteLength(execution.snapshot_json) <= 2048);
    const snapshot = JSON.parse(execution.snapshot_json) as {state: string; cancelRequested: boolean;
      admission: {state: string; disposition: string}; exitEvidence: {reason: string; oomKilled: boolean}};
    assert.equal(snapshot.state, 'exited'); assert.equal(snapshot.cancelRequested, true);
    assert.deepEqual(snapshot.admission, {state: 'released', disposition: 'settled'});
    assert.equal(snapshot.exitEvidence.reason, 'cancelled'); assert.equal(snapshot.exitEvidence.oomKilled, false);
    const engines = f.docker.ownedIds(f.id).flatMap(id => f.docker.json<Inspection[]>(['inspect', id]))
      .filter(container => container.Image === f.engineImage.Id);
    assert.equal(engines.length, 1); assert.equal(engines[0]!.State.Running, false);
    assert.equal(engines[0]!.State.OOMKilled, false);
    const allocations = db.prepare('SELECT charged_bytes FROM attempt_output_allocations WHERE attempt_id=? LIMIT 2').all(run.activeAttemptId);
    assert.equal(allocations.length, 1);
    assert.equal(allocations[0]!.charged_bytes, f.budget.outputBytes + 65536);
    // No source is fabricated for a cancelled engine that did not seal a result.
    assert.equal(db.prepare('SELECT attempt_id FROM execution_output_sources WHERE attempt_id=? LIMIT 1').all(run.activeAttemptId).length, 0);
    assert.equal(db.prepare('SELECT attempt_id FROM execution_output_finalizations WHERE attempt_id=? LIMIT 1').all(run.activeAttemptId).length, 0);
    return {executionReleased: true, engineStopped: true, resultPublished: result.result !== null,
      outputAllocationRetained: allocations[0]!.charged_bytes};
  } finally {db.close();}
}

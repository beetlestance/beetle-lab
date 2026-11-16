import { asSchema19 } from '../clock-reason/legacy019.js';
import type { DatabaseSync } from 'node:sqlite';
import { pendingRunHistorySummary } from '@beetle/contracts/api';
import type { RunHistorySummary } from '@beetle/contracts/api';
import { finalizationFixture, uuid } from '../../output-finalization/fixture.js';
import type { RunHistoryJob } from '../../../src/ports/run-history.js';
export { uuid, scope } from '../../output-finalization/fixture.js';
export function published() {
  const artifact = { artifactId: uuid(100), kind: 'numeric-final', relativePath: 'numeric-final.json', bytes: 32,
    sha256: 'b'.repeat(64), sealedAt: '2026-01-01T00:00:00Z' };
  const f = finalizationFixture({ artifacts: [artifact], events: 0 }); f.ready();
  const slot = JSON.parse(String(f.db.prepare('SELECT slot_json FROM execution_output_slots').get()?.slot_json)) as Record<string, unknown>;
  for (const patch of [{ v: 2, w: uuid(99) }, { v: 3, o: 32, i: 'd'.repeat(64), w: uuid(99) },
    { v: 4, o: 32, i: 'd'.repeat(64), w: uuid(99), p: 'publishing' }, { v: 5, o: 32, i: 'd'.repeat(64), w: null, p: 'published' }]) {
    f.db.prepare('UPDATE execution_output_slots SET slot_json=?').run(JSON.stringify({ ...slot, ...patch }));
  }
  if (f.finalize().kind !== 'finalized') throw new Error('Synthetic source not finalized');
  return { ...f, artifact };
}
export function summary(job: RunHistoryJob): RunHistorySummary {
  return { ...pendingRunHistorySummary({ id: job.id, activeAttemptId: job.attemptId }),
    availability: 'ready', source: { generation: 1, manifestDigest: job.manifestDigest!, numericArtifactId: uuid(100),
      numericSha256: 'b'.repeat(64), numericVersion: 4, measurementSourceTimeMs: 1000,
      coverage: { complete: true, latePoints: 0, markerDelayDroppedBuckets: 0 } },
    testDurationMs: 2000, requestCount: 4, requestsPerSecond: 2, httpFailures: 1, httpSamples: 4,
    httpFailureRatio: 0.25, publishedArtifactBytes: 32 };
}

/** Task-owned fixture only: recreate the actual predecessor schema before reopen. */
export function asSchema17(db: DatabaseSync): void {
  asSchema18(db);
  for (const name of ['history_summary_initial', 'history_summary_retained', 'history_summary_capture']) db.exec('DROP TRIGGER ' + name);
  db.exec('DROP INDEX run_history_due; ALTER TABLE runs DROP COLUMN history_summary_json; ALTER TABLE runs DROP COLUMN history_summary_due_ms; PRAGMA user_version=17;');
}

/** Remove only migration019 objects before testing earlier schema upgrades. */
export function asSchema18(db: DatabaseSync): void {
  asSchema19(db);
  for (const table of ['folders', 'suites']) {
    for (const event of ['insert', 'rename', 'delete']) db.exec('DROP TRIGGER ' + table + '_history_' + event);
  }
  for (const index of ['suites_history_folder', 'runs_history_suite', 'runs_history_suite_state',
    'runs_history_suite_outcome', 'runs_history_suite_state_outcome']) db.exec('DROP INDEX ' + index);
  db.exec('DROP TABLE history_name_grams; DROP TABLE history_name_progress; PRAGMA user_version=18;');
}

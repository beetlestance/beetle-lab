import type { DatabaseSync } from 'node:sqlite';
import type { Offer, AttemptSnapshot } from '@beetle/contracts';
import type { Run } from '@beetle/contracts/api';
import type { DispatchKey } from '../../src/ports/dispatch.js';
import { Store } from '../../src/adapters/outbound/sqlite/store.js';
import { reserveRunOutput } from '../../src/adapters/outbound/sqlite/output-reservations.js';
import { command, observation, settingsFixture, uuid, scope, requestId } from './fixture.js';
import { suiteCommand, request } from './suites-fixture.js';
import { runCommand, runOptions } from './runs-fixture.js';
export function seedFoundation(db: DatabaseSync): Store {
  const fixture = settingsFixture();
  fixture.chain.installation.values.pool.storageBytes = 200000;
  fixture.runtime.pool.storageBytes = 400000;
  const store = new Store(db, { installation: fixture.chain.installation, runtime: observation(fixture.runtime), ...runOptions(4096) });
  store.execute({ kind: 'namespace', command: command({ kind: 'createOrganization', id: uuid(1), request: {
    scope: { kind: 'installation' }, requestId: requestId(), name: 'Synthetic', slug: 'synthetic' } }) });
  store.execute({ kind: 'namespace', command: command({ kind: 'createWorkspace', id: uuid(2), rootFolderId: uuid(3), request: {
    scope: { kind: 'organization', organizationId: uuid(1) }, requestId: requestId(), name: 'Synthetic' } }) });
  store.execute({ kind: 'suite', command: suiteCommand({ kind: 'createSuite', id: uuid(50), request: { scope, requestId: requestId(), name: 'Synthetic' } }) });
  store.execute({ kind: 'suite', command: suiteCommand({ kind: 'createSuiteRevision', id: uuid(60), suiteId: uuid(50), request: request() }) });
  return store;
}
export function enqueue(db: DatabaseSync, store: Store, id = 70): { key: DispatchKey; offer: Offer; run: Run } {
  const run = store.execute({ kind: 'run', command: runCommand(uuid(60), id) }) as Run;
  const row = db.prepare('SELECT offer_json FROM attempts WHERE id=?').get(run.activeAttemptId)!;
  const offer = JSON.parse(String(row.offer_json)) as Offer;
  return { run, offer, key: { runId: run.id, attempt: { attemptId: offer.attemptId, organizationId: offer.organizationId,
    workspaceId: offer.workspaceId, intentDigest: offer.intentDigest, generation: 1 } } };
}
/** Structural claim fixture only; no eligibility decision or remote execution proof. */
export function insertRecord(db: DatabaseSync, key: DispatchKey): void {
  db.prepare(`INSERT INTO execution_records(attempt_id,queue_order,run_id,organization_id,workspace_id,intent_digest,
    delivery_attempt_id,output_attempt_id,journal_authority) SELECT attempt_id,queue_order,run_id,organization_id,workspace_id,intent_digest,
    attempt_id,attempt_id,'33333333-3333-4333-8333-333333333333' FROM execution_intents WHERE attempt_id=?`).run(key.attempt.attemptId);
}
export function reserveAndMark(db: DatabaseSync, key: DispatchKey, allocationBytes = Number.MAX_SAFE_INTEGER): void {
  insertRecord(db, key); reserveRunOutput(db, key, { allocationBytes, reserveBytes: 0 });
  db.prepare("UPDATE dispatch_outbox SET possible_delivery=1,first_delivery_at='2026-11-09T00:00:00.000Z' WHERE attempt_id=?").run(key.attempt.attemptId);
}
export function snapshotFor(key: DispatchKey, patch: Partial<AttemptSnapshot> = {}): AttemptSnapshot {
  return { protocolVersion: '1.0', ...key.attempt, state: 'admitted', lastSeq: 1, retainedStartSeq: 0,
    cancelRequested: false, ...patch };
}
export function acknowledge(db: DatabaseSync, key: DispatchKey, snapshot = snapshotFor(key)): void {
  db.prepare('UPDATE execution_records SET snapshot_json=?,acknowledged_generation=1,delivery_attempt_id=NULL WHERE attempt_id=?')
    .run(JSON.stringify(snapshot), key.attempt.attemptId);
  db.prepare('UPDATE attempts SET generation=1 WHERE id=?').run(key.attempt.attemptId);
  db.prepare('DELETE FROM dispatch_outbox WHERE attempt_id=?').run(key.attempt.attemptId);
}

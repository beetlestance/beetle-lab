import type { DatabaseSync } from 'node:sqlite';
import type { Run } from '@beetle/contracts/api';
import type { DispatchKey } from '../../src/ports/dispatch.js';
import { initialize } from '../../src/adapters/outbound/sqlite/schema.js';
import { Settings } from '../../src/adapters/outbound/sqlite/settings.js';
import { DispatchClaims } from '../../src/adapters/outbound/sqlite/dispatch-claims.js';
import { DispatchObservations } from '../../src/adapters/outbound/sqlite/dispatch-observations.js';
import { RunReads } from '../../src/adapters/outbound/sqlite/run-reads.js';
import { Suites } from '../../src/adapters/outbound/sqlite/suites.js';
import { Entities } from '../../src/adapters/outbound/sqlite/entities.js';
import { suiteCommand, request } from './suites-fixture.js';
import { seedFoundation, enqueue, snapshotFor } from './execution-foundation-fixtures.js';
import { runCommand, runOptions, runRequest } from './runs-fixture.js';
import { observation, settingsFixture, uuid, command, requestId } from './fixture.js';

export function claimsFixture(storageBytes=400000) {
  const db = initialize(':memory:');
  const store = seedFoundation(db,storageBytes);
  const installation = settingsFixture().chain.installation;
  installation.values.pool.storageBytes = storageBytes;
  const runtime = observation(settingsFixture().runtime);
  runtime.ceilings.pool.storageBytes = storageBytes;
  const settings = new Settings(db, { installation, runtime });
  const config = runOptions(4096).runs!;
  const claims = new DispatchClaims(db, settings, config);
  const reads = new RunReads(db, new Suites(db, new Entities(db)));
  const observations = new DispatchObservations(db, reads);
  function add(id = 70, mode: 'parallel' | 'isolated' = 'parallel', budget = 100, output = 100): DispatchKey {
    const request = runRequest(uuid(60));
    request.executionPolicy.mode = mode;
    request.budget.cpuMillis = budget;
    request.budget.outputBytes = output;
    const run = store.execute({ kind: 'run', command: runCommand(uuid(60), id, request) }) as Run;
    const row = db.prepare('SELECT intent_digest FROM attempts WHERE id=?').get(run.activeAttemptId)!;
    return { runId: run.id, attempt: { attemptId: run.activeAttemptId, organizationId: uuid(1),
      workspaceId: uuid(2), intentDigest: String(row.intent_digest), generation: 1 } };
  }
  function addOther(): DispatchKey {
    const scope = { kind: 'workspace' as const, organizationId: uuid(21), workspaceId: uuid(22) };
    store.execute({ kind: 'namespace', command: command({ kind: 'createOrganization', id: uuid(21), request: {
      scope: { kind: 'installation' }, requestId: requestId(), name: 'Other synthetic', slug: 'other-synthetic' } }) });
    store.execute({ kind: 'namespace', command: command({ kind: 'createWorkspace', id: uuid(22), rootFolderId: uuid(23), request: {
      scope: { kind: 'organization', organizationId: uuid(21) }, requestId: requestId(), name: 'Other synthetic' } }) });
    store.execute({ kind: 'suite', command: suiteCommand({ kind: 'createSuite', id: uuid(51), request: {
      scope, requestId: requestId(), name: 'Other synthetic' } }) });
    store.execute({ kind: 'suite', command: suiteCommand({ kind: 'createSuiteRevision', id: uuid(61), suiteId: uuid(51),
      request: { ...request(), scope } }) });
    const create = { ...runRequest(uuid(61)), scope };
    const run = store.execute({ kind: 'run', command: runCommand(uuid(61), 72, create) }) as Run;
    const row = db.prepare('SELECT intent_digest FROM attempts WHERE id=?').get(run.activeAttemptId)!;
    return { runId: run.id, attempt: { attemptId: run.activeAttemptId, organizationId: scope.organizationId,
      workspaceId: scope.workspaceId, intentDigest: String(row.intent_digest), generation: 1 } };
  }
  function policy(change: (values: typeof installation.values) => void): void {
    const row = db.prepare("SELECT value_json FROM settings WHERE scope_key='installation'").get()!;
    const values = JSON.parse(String(row.value_json)) as typeof installation.values;
    change(values);
    db.prepare("UPDATE settings SET value_json=? WHERE scope_key='installation'").run(JSON.stringify(values));
  }
  function release(key: DispatchKey): void {
    observations.observe({ journalAuthority: '33333333-3333-4333-8333-333333333333', key, snapshot: snapshotFor(key, { admission: { state: 'released', disposition: 'settled' } }) });
  }
  return { db, store, settings, config, claims, reads, observations, runtime, add, addOther, policy, release,
    original: () => enqueue(db, store) };
}
export type ClaimsFixture = ReturnType<typeof claimsFixture>;
export function custody(db: DatabaseSync): unknown[] {
  return ['runs', 'attempts', 'dispatch_outbox', 'execution_records', 'attempt_output_allocations', 'installation_storage_usage']
    .map(table => db.prepare(`SELECT * FROM ${table}`).all());
}

/** Emulate preserved pre-foundation rows without inventing tracked ownership. */
export function makeLegacy(db: DatabaseSync, key: DispatchKey): void {
  db.exec(`DROP TRIGGER attempts_summary_marker; DROP TRIGGER outbox_summary_marker;
    DROP TRIGGER attempts_foundation_immutable; DROP TRIGGER execution_intent_retained;`);
  db.prepare('UPDATE attempts SET execution_intent_id=NULL,foundation_owned=0 WHERE id=?').run(key.attempt.attemptId);
  db.prepare('UPDATE dispatch_outbox SET execution_intent_id=NULL WHERE attempt_id=?').run(key.attempt.attemptId);
  db.prepare('DELETE FROM execution_intents WHERE attempt_id=?').run(key.attempt.attemptId);
}

import { afterEach, beforeEach, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import type { AttemptAdmission, AttemptSnapshot } from '@beetle/contracts';
import type { DispatchKey } from '../../src/ports/dispatch.js';
import { DispatchObservations } from '../../src/adapters/outbound/sqlite/dispatch-observations.js';
import { RunReads } from '../../src/adapters/outbound/sqlite/run-reads.js';
import { Suites } from '../../src/adapters/outbound/sqlite/suites.js';
import { Entities } from '../../src/adapters/outbound/sqlite/entities.js';
import { initialize, transaction } from '../../src/adapters/outbound/sqlite/schema.js';
import { seedFoundation, enqueue, reserveAndMark, snapshotFor } from './execution-foundation-fixtures.js';

let db: DatabaseSync;
let key: DispatchKey;
let observations: DispatchObservations;
let reads: RunReads;
beforeEach(() => {
  db = initialize(':memory:');
  key = enqueue(db, seedFoundation(db)).key;
  transaction(db, () => reserveAndMark(db, key));
  reads = new RunReads(db, new Suites(db, new Entities(db)));
  observations = new DispatchObservations(db, reads);
});
afterEach(() => db.close());

it('ACKs the owned prior delivery before deleting outbox and preserves original Run intent', () => {
  const intent = db.prepare('SELECT snapshot_json FROM runs').get();
  db.exec(`CREATE TABLE ack_order(step TEXT);
    CREATE TRIGGER check_detached AFTER UPDATE ON execution_records BEGIN
      SELECT CASE WHEN NEW.delivery_attempt_id IS NOT NULL OR NEW.acknowledged_generation IS NOT 1
      OR NOT EXISTS(SELECT 1 FROM dispatch_outbox WHERE attempt_id=NEW.attempt_id AND possible_delivery=1)
      THEN RAISE(ABORT,'bad ACK order') END; INSERT INTO ack_order VALUES('record'); END;
    CREATE TRIGGER check_generation AFTER UPDATE ON attempts BEGIN
      SELECT CASE WHEN NEW.generation IS NOT 1 OR NOT EXISTS(SELECT 1 FROM dispatch_outbox WHERE attempt_id=NEW.id)
      THEN RAISE(ABORT,'bad attempt order') END; INSERT INTO ack_order VALUES('attempt'); END;
    CREATE TRIGGER check_delete AFTER DELETE ON dispatch_outbox BEGIN INSERT INTO ack_order VALUES('delete'); END;
    CREATE TRIGGER check_projection AFTER UPDATE ON runs BEGIN
      SELECT CASE WHEN EXISTS(SELECT 1 FROM dispatch_outbox) THEN RAISE(ABORT,'bad projection order') END;
      INSERT INTO ack_order VALUES('run'); END;`);
  const value = observations.observe({ journalAuthority: '33333333-3333-4333-8333-333333333333', key, snapshot: snapshotFor(key) });
  expect(value).toMatchObject({ executionCharged: true, runChanged: true, run: {
    version: 2, state: 'active', outcome: 'pending', validationStatus: 'pending' } });
  expect(db.prepare('SELECT step FROM ack_order').all().map(row => row.step)).toEqual(['record', 'attempt', 'delete', 'run']);
  expect(db.prepare('SELECT snapshot_json FROM runs').get()).toEqual(intent);
  expect(db.prepare('SELECT generation,state FROM attempts').get()).toMatchObject({ generation: 1, state: 'admitted' });
  expect(db.prepare('SELECT delivery_attempt_id,acknowledged_generation FROM execution_records').get())
    .toMatchObject({ delivery_attempt_id: null, acknowledged_generation: 1 });
  expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
});

it('replays exact observations without version increments and copies retained output', () => {
  const incoming = snapshotFor(key);
  const first = observations.observe({ journalAuthority: '33333333-3333-4333-8333-333333333333', key, snapshot: incoming });
  incoming.cancelRequested = true;
  const replay = observations.observe({ journalAuthority: '33333333-3333-4333-8333-333333333333', key, snapshot: snapshotFor(key) });
  expect(replay).toEqual({ ...first, runChanged: false });
  (first.snapshot as AttemptSnapshot).lastSeq = 999;
  first.run.state = 'finalizing';
  expect(observations.observe({ journalAuthority: '33333333-3333-4333-8333-333333333333', key, snapshot: snapshotFor(key) })).toEqual(replay);
  expect(db.prepare('SELECT count(*) n FROM dispatch_outbox').get()?.n).toBe(0);
});

const retainedAdmissions: (AttemptAdmission | undefined)[] = [undefined, { state: 'queued' }, { state: 'charged' }];
it.each(retainedAdmissions)('retains execution and output charge without final proof %j', admission => {
  const output = db.prepare('SELECT * FROM attempt_output_allocations').all();
  const usage = db.prepare('SELECT * FROM installation_storage_usage').all();
  const patch = admission === undefined ? {} : { admission };
  for (const state of ['admitted', 'lost', 'exited'] as const) {
    const snapshot = snapshotFor(key, { ...patch, state, lastSeq: state === 'admitted' ? 1 : state === 'lost' ? 2 : 3 });
    const value = observations.observe({ journalAuthority: '33333333-3333-4333-8333-333333333333', key, snapshot });
    expect(value.executionCharged).toBe(true);
    expect(value.run.outcome).toBe('pending');
    expect(value.run.validationStatus).toBe('pending');
  }
  expect(db.prepare('SELECT * FROM attempt_output_allocations').all()).toEqual(output);
  expect(db.prepare('SELECT * FROM installation_storage_usage').all()).toEqual(usage);
});

it.each<AttemptAdmission>([{ state: 'released', disposition: 'settled' }, { state: 'released', disposition: 'never_started' },
  { state: 'rejected', reason: 'cancelled' }])('releases execution once for matched final proof %j and retains output', admission => {
  const output = db.prepare('SELECT * FROM attempt_output_allocations').all();
  const usage = db.prepare('SELECT * FROM installation_storage_usage').all();
  const costs = db.prepare('SELECT * FROM execution_intents').all();
  const snapshot = snapshotFor(key, { admission });
  const value = observations.observe({ journalAuthority: '33333333-3333-4333-8333-333333333333', key, snapshot });
  expect(value).toMatchObject({ executionCharged: false, run: { state: 'finalizing', outcome: 'pending', validationStatus: 'pending' } });
  expect(observations.observe({ journalAuthority: '33333333-3333-4333-8333-333333333333', key, snapshot: snapshotFor(key, { lastSeq: 2 }) })).toMatchObject({
    executionCharged: false, runChanged: false, snapshot: { admission } });
  expect(db.prepare('SELECT * FROM attempt_output_allocations').all()).toEqual(output);
  expect(db.prepare('SELECT * FROM installation_storage_usage').all()).toEqual(usage);
  expect(db.prepare('SELECT * FROM execution_intents').all()).toEqual(costs);
  expect(db.prepare('SELECT snapshot_json FROM execution_records').get()?.snapshot_json).toContain(JSON.stringify(admission));
  expect(() => db.exec('UPDATE execution_records SET execution_charged=1')).toThrow();
});

it('merges older admission enrichment independently of sequence without acknowledging event bytes', () => {
  observations.observe({ journalAuthority: '33333333-3333-4333-8333-333333333333', key, snapshot: snapshotFor(key, { lastSeq: 7, retainedStartSeq: 3, admission: { state: 'charged' } }) });
  const value = observations.observe({ journalAuthority: '33333333-3333-4333-8333-333333333333', key, snapshot: snapshotFor(key, { lastSeq: 2, retainedStartSeq: 2,
    admission: { state: 'released', disposition: 'settled' } }) });
  expect(value).toMatchObject({ executionCharged: false, snapshot: { lastSeq: 7, retainedStartSeq: 3 },
    run: { state: 'finalizing', version: 3 } });
  const next = observations.observe({ journalAuthority: '33333333-3333-4333-8333-333333333333', key, snapshot: snapshotFor(key, { lastSeq: 8, retainedStartSeq: 8 }) });
  expect(next.runChanged).toBe(false);
  expect(next.run.version).toBe(3);
  expect(next.snapshot.retainedStartSeq).toBe(8);
  expect(db.prepare('PRAGMA table_info(execution_records)').all().map(row => row.name)).not.toContain('ack_seq');
});

it.each([false, true])('ORs durable cancellation intent with remote cancellation (local %s)', local => {
  if (local) db.exec('UPDATE runs SET cancellation_requested=1');
  const first = observations.observe({ journalAuthority: '33333333-3333-4333-8333-333333333333', key, snapshot: snapshotFor(key, { cancelRequested: !local }) });
  expect(first.run.cancellationRequested).toBe(true);
  const next = observations.observe({ journalAuthority: '33333333-3333-4333-8333-333333333333', key, snapshot: snapshotFor(key, { lastSeq: 2 }) });
  expect(next.run.cancellationRequested).toBe(true);
  expect(next.runChanged).toBe(false);
});

it.each(['finished', 'cancelled', 'errored'] as const)('preserves terminal %s Run DTO and version while private facts advance', state => {
  const reason = state === 'finished' ? null : state === 'cancelled' ? 'cancelled' : 'engine_crash';
  db.prepare('UPDATE runs SET state=?,outcome=?,validation_status=?,reason=?,cancellation_requested=?,version=17')
    .run(state, state === 'finished' ? 'passed' : 'inconclusive', state === 'finished' ? 'passed' : 'pending', reason, Number(state === 'cancelled'));
  const before = reads.get({ id: key.runId, scope: { kind: 'workspace', organizationId: key.attempt.organizationId, workspaceId: key.attempt.workspaceId } });
  const value = observations.observe({ journalAuthority: '33333333-3333-4333-8333-333333333333', key, snapshot: snapshotFor(key, { lastSeq: 7, state: 'exited', cancelRequested: true,
    admission: { state: 'released', disposition: 'settled' } }) });
  expect(value).toMatchObject({ run: before, runChanged: false, executionCharged: false });
  expect(value.snapshot.cancelRequested).toBe(true);
  expect(db.prepare('SELECT state,generation FROM attempts').get()).toMatchObject({ state: 'exited', generation: 1 });
});

it('reopens a persisted acknowledged database and replays without outbox or recharging', () => {
  const directory = mkdtempSync(join(tmpdir(), 'w115-dispatch-observations-'));
  let persisted: DatabaseSync | undefined;
  try {
    const path = join(directory, 'metadata.sqlite');
    persisted = initialize(path);
    const original = enqueue(persisted, seedFoundation(persisted));
    transaction(persisted, () => reserveAndMark(persisted!, original.key));
    const first = new DispatchObservations(persisted, new RunReads(persisted, new Suites(persisted, new Entities(persisted))))
      .observe({ journalAuthority: '33333333-3333-4333-8333-333333333333', key: original.key, snapshot: snapshotFor(original.key, { admission: { state: 'released', disposition: 'settled' } }) });
    persisted.close();
    persisted = initialize(path);
    const replay = new DispatchObservations(persisted, new RunReads(persisted, new Suites(persisted, new Entities(persisted))))
      .observe({ journalAuthority: '33333333-3333-4333-8333-333333333333', key: original.key, snapshot: snapshotFor(original.key) });
    expect(replay).toEqual({ ...first, runChanged: false });
    expect(persisted.prepare('SELECT count(*) n FROM dispatch_outbox').get()?.n).toBe(0);
    expect(persisted.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  } finally { persisted?.close(); rmSync(directory, { recursive: true, force: true }); }
});

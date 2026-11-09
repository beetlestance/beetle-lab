import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { DatabaseSync, StatementSync } from 'node:sqlite';
import type { AttemptSnapshot } from '@beetle/contracts';
import type { DispatchKey, DispatchObservationRequest } from '../../src/ports/dispatch.js';
import { captureDispatchKey } from '../../src/adapters/outbound/sqlite/dispatch-values.js';
import { DispatchObservations } from '../../src/adapters/outbound/sqlite/dispatch-observations.js';
import { RunReads } from '../../src/adapters/outbound/sqlite/run-reads.js';
import { Suites } from '../../src/adapters/outbound/sqlite/suites.js';
import { Entities } from '../../src/adapters/outbound/sqlite/entities.js';
import { initialize, transaction } from '../../src/adapters/outbound/sqlite/schema.js';
import { reserveRunOutput } from '../../src/adapters/outbound/sqlite/output-reservations.js';
import { seedFoundation, enqueue, reserveAndMark, snapshotFor, insertRecord } from './execution-foundation-fixtures.js';
import { uuid } from './fixture.js';
import { result } from '../domain/run-observation-fixtures.js';

let db: DatabaseSync;
let key: DispatchKey;
let reads: RunReads;
let observations: DispatchObservations;
beforeEach(() => {
  db = initialize(':memory:');
  key = enqueue(db, seedFoundation(db)).key;
  reads = new RunReads(db, new Suites(db, new Entities(db)));
  observations = new DispatchObservations(db, reads);
});
afterEach(() => { vi.restoreAllMocks(); db.close(); });
function mark(): void { transaction(db, () => reserveAndMark(db, key)); }
function tables(): unknown[] {
  return ['execution_records', 'execution_intents', 'attempts', 'dispatch_outbox', 'runs',
    'attempt_output_allocations', 'installation_storage_usage'].map(table => db.prepare(`SELECT * FROM ${table}`).all());
}
function rejects(request: unknown): void {
  const before = tables();
  expect(() => observations.observe(request as DispatchObservationRequest)).toThrow();
  expect(tables()).toEqual(before);
  expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
}

it('refuses a missing record without creating, adopting or charging ownership', () => {
  rejects({ journalAuthority: '33333333-3333-4333-8333-333333333333', key, snapshot: snapshotFor(key) });
  expect(db.prepare('SELECT count(*) n FROM execution_records').get()?.n).toBe(0);
});
it('cannot retain an unsent record and refuses an unsent Offer without ACK or outbox deletion', () => {
  const before = tables();
  expect(() => transaction(db, () => {
    insertRecord(db, key);
    reserveRunOutput(db, key, { allocationBytes: Number.MAX_SAFE_INTEGER, reserveBytes: 0 });
  })).toThrow('FOREIGN KEY constraint failed');
  expect(tables()).toEqual(before);
  expect(db.prepare('SELECT possible_delivery FROM dispatch_outbox').get()?.possible_delivery).toBe(0);
  rejects({ journalAuthority: '33333333-3333-4333-8333-333333333333', key, snapshot: snapshotFor(key) });
});

it.each(['runId', 'attemptId', 'organizationId', 'workspaceId', 'intentDigest', 'generation'] as const)('rejects wrong immutable key %s', field => {
    mark();
    const wrong = { runId: key.runId, attempt: { ...key.attempt } };
    if (field === 'runId') wrong.runId = uuid(99);
    else if (field === 'intentDigest') wrong.attempt.intentDigest = 'f'.repeat(64);
    else if (field === 'generation') (wrong.attempt as { generation: number }).generation = 2;
    else wrong.attempt[field] = uuid(99);
    rejects({ journalAuthority: '33333333-3333-4333-8333-333333333333', key: wrong, snapshot: snapshotFor(key) });
  });

it('captures the closed key without normalization and isolates the captured copy', () => {
  const original = { runId: key.runId, attempt: { ...key.attempt } };
  original.runId = 'ABCDEF00-0000-4000-8000-000000000070';
  const captured = captureDispatchKey(original);
  expect(captured.runId).toBe(original.runId);
  original.attempt.intentDigest = 'b'.repeat(64);
  expect(captured.attempt.intentDigest).toBe(key.attempt.intentDigest);
  expect(() => captureDispatchKey({ ...key, extra: true })).toThrow();
  expect(() => captureDispatchKey({ ...key, attempt: { ...key.attempt, extra: true } })).toThrow();
  expect(() => captureDispatchKey({ ...key, attempt: { ...key.attempt, intentDigest: 'A'.repeat(64) } })).toThrow();
  expect(() => captureDispatchKey({ ...key, attempt: { ...key.attempt, attemptId: 'x'.repeat(1024) } })).toThrow();
});

it.each(['key', 'snapshot', 'attempt', 'attemptId'] as const)('rejects %s accessors before invoking caller code or SQL', field => {
  mark();
  const getter = vi.fn(() => { throw new Error('secret canary'); });
  const request = { journalAuthority: '33333333-3333-4333-8333-333333333333', key: structuredClone(key), snapshot: snapshotFor(key) };
  const target = field === 'attemptId' ? request.key.attempt : field === 'attempt' ? request.key : request;
  Object.defineProperty(target, field, { get: getter, enumerable: true });
  const prepare = vi.spyOn(db, 'prepare');
  expect(() => observations.observe(request)).toThrow();
  expect(getter).not.toHaveBeenCalled();
  expect(prepare).not.toHaveBeenCalled();
});

it.each([{ name: 'null', snapshot: null }, { name: 'empty', snapshot: {} }, { name: 'incomplete', snapshot: { state: 'admitted' } },
  { name: 'snapshot-byte overflow', snapshot: { invalid: 'x'.repeat(73_729) } },
  { name: 'request-byte overflow', snapshot: { invalid: 'x'.repeat(75_777) } }])('rejects $name original snapshot atomically', ({ snapshot }) => { mark(); rejects({ journalAuthority: '33333333-3333-4333-8333-333333333333', key, snapshot }); });
it('rejects open envelopes and non-JSON originals before key/snapshot access', () => {
  mark();
  rejects({ journalAuthority: '33333333-3333-4333-8333-333333333333', key, snapshot: snapshotFor(key), extra: true });
  rejects({ journalAuthority: '33333333-3333-4333-8333-333333333333', key, snapshot: snapshotFor(key), extra: undefined });
  rejects({ journalAuthority: '33333333-3333-4333-8333-333333333333', key, snapshot: { ...snapshotFor(key), lastSeq: Number.NaN } });
});

it.each(['attemptId', 'organizationId', 'workspaceId', 'intentDigest', 'generation'] as const)('rejects wrong snapshot %s', field => {
    mark();
    const snapshot = snapshotFor(key);
    if (field === 'intentDigest') snapshot.intentDigest = 'f'.repeat(64);
    else if (field === 'generation') snapshot.generation = 2;
    else snapshot[field] = uuid(99);
    rejects({ journalAuthority: '33333333-3333-4333-8333-333333333333', key, snapshot });
  });
it.each(['attemptId', 'organizationId', 'workspaceId', 'generation'] as const)('rejects nested result %s mismatch', field => {
  mark();
  const nested = { ...result(), attemptId: key.attempt.attemptId, organizationId: key.attempt.organizationId,
    workspaceId: key.attempt.workspaceId, generation: 1 };
  if (field === 'generation') nested.generation = 2;
  else nested[field] = uuid(99);
  rejects({ journalAuthority: '33333333-3333-4333-8333-333333333333', key, snapshot: snapshotFor(key, { result: nested }) });
});

it.each<Partial<AttemptSnapshot>>([{ lastSeq: 1, state: 'running' }, { lastSeq: 2, state: 'offered' },
  { lastSeq: 3, retainedStartSeq: 5 }, { lastSeq: 0, state: 'exited' }])('rolls back conflicting sequence/cursor/chronology %j', patch => {
  mark(); observations.observe({ journalAuthority: '33333333-3333-4333-8333-333333333333', key, snapshot: snapshotFor(key) });
  rejects({ journalAuthority: '33333333-3333-4333-8333-333333333333', key, snapshot: snapshotFor(key, patch) });
});
it('accepts compatible stale observations without rewinding state, then rejects admission conflict', () => {
  mark();
  observations.observe({ journalAuthority: '33333333-3333-4333-8333-333333333333', key, snapshot: snapshotFor(key, { lastSeq: 5, state: 'exited', admission: { state: 'released', disposition: 'settled' } }) });
  expect(observations.observe({ journalAuthority: '33333333-3333-4333-8333-333333333333', key, snapshot: snapshotFor(key, { lastSeq: 3 }) })).toMatchObject({
    snapshot: { lastSeq: 5, state: 'exited' }, runChanged: false, executionCharged: false });
  rejects({ journalAuthority: '33333333-3333-4333-8333-333333333333', key, snapshot: snapshotFor(key, { lastSeq: 6, state: 'exited', admission: { state: 'released', disposition: 'never_started' } }) });
});

it('revalidates stored snapshot cursor semantics through the merge owner before any mutation', () => {
  mark();
  observations.observe({ journalAuthority: '33333333-3333-4333-8333-333333333333', key, snapshot: snapshotFor(key) });
  // Existing SQL guards validate scalar bounds, while the domain owns cursor chronology.
  db.prepare('UPDATE execution_records SET snapshot_json=?')
    .run(JSON.stringify(snapshotFor(key, { retainedStartSeq: 3 })));
  rejects({ journalAuthority: '33333333-3333-4333-8333-333333333333', key, snapshot: snapshotFor(key, { lastSeq: 2 }) });
});

it('allows unchanged replay at maximum version but aborts changed DTO before ACK', () => {
  mark();
  db.prepare('UPDATE runs SET version=?').run(Number.MAX_SAFE_INTEGER);
  rejects({ journalAuthority: '33333333-3333-4333-8333-333333333333', key, snapshot: snapshotFor(key) });
  db.exec("UPDATE runs SET state='active'");
  const value = observations.observe({ journalAuthority: '33333333-3333-4333-8333-333333333333', key, snapshot: snapshotFor(key) });
  expect(value).toMatchObject({ runChanged: false, run: { version: Number.MAX_SAFE_INTEGER } });
  rejects({ journalAuthority: '33333333-3333-4333-8333-333333333333', key, snapshot: snapshotFor(key, { lastSeq: 2, cancelRequested: true }) });
  expect(observations.observe({ journalAuthority: '33333333-3333-4333-8333-333333333333', key, snapshot: snapshotFor(key, { lastSeq: 2 }) })).toMatchObject({ runChanged: false });
});

it.each(['attempts', 'dispatch_outbox', 'runs'] as const)('rolls every table back on late %s trigger failure', table => {
  mark();
  const event = table === 'dispatch_outbox' ? 'DELETE' : 'UPDATE';
  db.exec(`CREATE TRIGGER synthetic_failure BEFORE ${event} ON ${table} BEGIN SELECT RAISE(ABORT,'synthetic late failure'); END;`);
  rejects({ journalAuthority: '33333333-3333-4333-8333-333333333333', key, snapshot: snapshotFor(key, { admission: { state: 'released', disposition: 'settled' } }) });
});
it('rolls back ACK and execution release when resulting public Run read fails', () => {
  mark();
  const get = reads.get.bind(reads);
  vi.spyOn(reads, 'get').mockImplementationOnce(get).mockImplementationOnce(() => { throw new Error('synthetic projection failure'); });
  rejects({ journalAuthority: '33333333-3333-4333-8333-333333333333', key, snapshot: snapshotFor(key, { admission: { state: 'released', disposition: 'settled' } }) });
});
it('rolls back ACK and release when resulting reply exceeds its original serialization bound', () => {
  mark();
  const get = reads.get.bind(reads);
  vi.spyOn(reads, 'get').mockImplementationOnce(get).mockImplementationOnce(query => ({ ...get(query), extra: 'x'.repeat(1_048_576) }));
  rejects({ journalAuthority: '33333333-3333-4333-8333-333333333333', key, snapshot: snapshotFor(key, { admission: { state: 'released', disposition: 'settled' } }) });
});

it('CASE-bounds stored snapshot materialization and never selects Offer, registry or attempt history payloads', () => {
  mark();
  const prepare = vi.spyOn(db, 'prepare');
  observations.observe({ journalAuthority: '33333333-3333-4333-8333-333333333333', key, snapshot: snapshotFor(key) });
  const queries = prepare.mock.calls.map(([sql]) => sql);
  const record = queries.find(sql => sql.includes('FROM execution_records'))!;
  expect(record).toMatch(/CASE WHEN length\(CAST\(e.snapshot_json AS BLOB\)\)<=73728 THEN e.snapshot_json ELSE NULL END/);
  expect(queries.join('\n')).not.toMatch(/offer_json|registry_json|config_json|SELECT \* FROM attempts/i);
});
it('rejects an oversized stored snapshot from its scalar size before reading or parsing its text', () => {
  mark();
  const prepare = db.prepare.bind(db);
  const text = vi.fn(() => { throw new Error('unbounded materialization'); });
  vi.spyOn(db, 'prepare').mockImplementation(sql => {
    if (!sql.includes('FROM execution_records')) return prepare(sql);
    return { get: () => Object.defineProperty({ snapshot_bytes: 73_729, execution_charged: 1,
      acknowledged_generation: 1, delivery_attempt_id: null, generation: 1 }, 'snapshot_json', { get: text }) } as unknown as StatementSync;
  });
  expect(() => observations.observe({ journalAuthority: '33333333-3333-4333-8333-333333333333', key, snapshot: snapshotFor(key) })).toThrow();
  expect(text).not.toHaveBeenCalled();
});

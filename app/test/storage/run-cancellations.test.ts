import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { claimsFixture } from './dispatch-claim-fixtures.js';
import type { ClaimsFixture } from './dispatch-claim-fixtures.js';
import { cancel, cancelCommand, retained } from './run-cancellation-fixtures.js';
import { scope, uuid, requestId, command as namespaceCommand } from './fixture.js';
import { snapshotFor } from './execution-foundation-fixtures.js';
import { runCommand } from './runs-fixture.js';

let f: ClaimsFixture;
beforeEach(() => { vi.useFakeTimers(); f = claimsFixture(); });
afterEach(() => { f.db.close(); vi.useRealTimers(); });

it('cancels authoritative unsent work before a captured queue key can claim it', () => {
  const key = f.add();
  const stale = f.claims.scan({ lane: 'queued', limit: 1 }).items[0]!.key;
  expect(stale).toEqual(key);
  const intent = f.db.prepare('SELECT snapshot_json FROM runs').get();
  const attempts = f.db.prepare('SELECT * FROM attempts').all();
  const costs = f.db.prepare('SELECT * FROM execution_intents').all();
  expect(cancel(f)).toMatchObject({ version: 2, state: 'cancelled', outcome: 'inconclusive',
    reason: 'cancelled', cancellationRequested: true, validationStatus: 'pending' });
  expect(f.claims.claim(stale)).toEqual({ kind: 'blocked', reason: 'not_queued' });
  expect(f.claims.scan({ lane: 'queued', limit: 1 }).items).toEqual([]);
  expect(f.db.prepare('SELECT * FROM dispatch_outbox').all()).toEqual([]);
  expect(f.db.prepare('SELECT * FROM execution_records').all()).toEqual([]);
  expect(f.db.prepare('SELECT * FROM attempt_output_allocations').all()).toEqual([]);
  expect(f.db.prepare('SELECT snapshot_json FROM runs').get()).toEqual(intent);
  expect(f.db.prepare('SELECT * FROM attempts').all()).toEqual(attempts);
  expect(f.db.prepare('SELECT * FROM execution_intents').all()).toEqual(costs);
  expect(f.db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
});

it.each(['pending', 'failed', 'passed'] as const)('retains actual %s validation on unsent closure', validation => {
  f.add(); f.db.prepare('UPDATE runs SET validation_status=?').run(validation);
  expect(cancel(f)).toMatchObject({ state: 'cancelled', validationStatus: validation });
});

it.each(['possible', 'acknowledged', 'released'] as const)('records cancellation after %s delivery without changing physical custody', phase => {
  const key = f.add(); expect(f.claims.claim(key).kind).toBe('claimed');
  if (phase !== 'possible') f.observations.observe({ journalAuthority: f.runtime.journalAuthority, key,
    snapshot: snapshotFor(key, phase === 'released' ? { admission: { state: 'released', disposition: 'settled' } } : {}) });
  const before = retained(f);
  const run = f.reads.get({ scope, id: key.runId });
  const command = cancelCommand();
  const result = cancel(f, command);
  expect(result).toEqual({ ...run, version: run.version + 1, cancellationRequested: true });
  expect(retained(f)).toEqual(before);
  expect(cancel(f)).toEqual(result);
  expect(cancel(f, command)).toEqual(result);
  expect(retained(f)).toEqual(before);
  expect(f.claims.claim(key).kind).toBe(phase === 'possible' ? 'replay' : 'acknowledged');
});

it('replays the exact earlier receipt after later public projection changes', () => {
  const key = f.add(); f.claims.claim(key);
  const command = cancelCommand(); const accepted = cancel(f, command);
  f.observations.observe({ journalAuthority: f.runtime.journalAuthority, key, snapshot: snapshotFor(key) });
  expect(f.reads.get({ scope, id: key.runId })).toMatchObject({ state: 'active', version: 4, cancellationRequested: true });
  expect(cancel(f, command)).toEqual(accepted);
  expect(cancel(f)).toMatchObject({ state: 'active', version: 4, cancellationRequested: true });
});

it.each(['scope', 'identity', 'outcome', 'bound'] as const)('rejects a corrupt %s response receipt without rewriting current history', corruption => {
  f.add(); const command = cancelCommand(); const receipt = cancel(f, command);
  const changed = { ...receipt } as Record<string, unknown>;
  if (corruption === 'scope') changed.scope = { ...scope, workspaceId: uuid(999) };
  if (corruption === 'identity') changed.id = uuid(999);
  if (corruption === 'outcome') changed.outcome = 'passed';
  if (corruption === 'bound') changed.extra = 'x'.repeat(65536);
  f.db.prepare('UPDATE receipts SET result_json=? WHERE request_id=?').run(JSON.stringify(changed), command.request.requestId);
  const before = retained(f);
  expect(() => cancel(f, command)).toThrow('Storage unavailable');
  expect(retained(f)).toEqual(before);
  expect(f.reads.get({ scope, id: uuid(70) })).toEqual(receipt);
});

it.each(['finished', 'errored', 'cancelled'] as const)('preserves terminal %s history and version for new cancellation IDs', state => {
  const key = f.add();
  f.db.prepare('UPDATE runs SET state=?,outcome=?,validation_status=?,reason=?,cancellation_requested=?,version=17')
    .run(state, state === 'finished' ? 'failed' : 'inconclusive', state === 'finished' ? 'passed' : 'pending',
      state === 'finished' ? null : state === 'cancelled' ? 'cancelled' : 'engine_crash', Number(state === 'cancelled'));
  const before = f.reads.get({ scope, id: key.runId }); const custody = retained(f);
  expect(cancel(f)).toEqual(before); expect(cancel(f)).toEqual(before);
  expect(retained(f)).toEqual(custody);
});

it('binds scope and shared receipt IDs to exact operation and run', () => {
  f.add(); f.addOther();
  const before = retained(f);
  const wrong = cancelCommand(uuid(70), { scope: { ...scope, organizationId: uuid(21), workspaceId: uuid(22) }, requestId: requestId() });
  expect(() => cancel(f, wrong)).toThrow(expect.objectContaining({ code: 'not_found' }));
  expect(retained(f)).toEqual(before);
  const collision = requestId();
  f.store.execute({ kind: 'namespace', command: namespaceCommand({ kind: 'createFolder', id: uuid(90),
    request: { scope, requestId: collision, name: 'Synthetic receipt owner', parentFolderId: uuid(3) } }) });
  expect(() => cancel(f, cancelCommand(uuid(70), { scope, requestId: collision }))).toThrow('conflict');
  const command = cancelCommand(); cancel(f, command);
  expect(() => cancel(f, cancelCommand(uuid(72), command.request))).toThrow('conflict');
  expect(() => f.store.execute({ kind: 'run', command: runCommand(uuid(60), 73,
    { ...runCommand(uuid(60), 73).request, requestId: command.request.requestId }) })).toThrow('conflict');
});

it.each(['projection', 'receipt', 'version'] as const)('rolls back outbox retirement and intent on late %s failure', stage => {
  f.add();
  if (stage === 'version') f.db.exec('UPDATE runs SET version=9007199254740991');
  else if (stage === 'projection') f.db.exec("CREATE TRIGGER reject_cancel BEFORE UPDATE ON runs BEGIN SELECT RAISE(ABORT,'synthetic projection failure'); END;");
  else f.db.exec("CREATE TRIGGER reject_cancel BEFORE INSERT ON receipts BEGIN SELECT RAISE(ABORT,'synthetic receipt failure'); END;");
  const command = cancelCommand(); const before = retained(f); const run = f.reads.get({ scope, id: uuid(70) });
  expect(() => cancel(f, command)).toThrow();
  expect(f.reads.get({ scope, id: uuid(70) })).toEqual(run);
  expect(retained(f)).toEqual(before);
  expect(f.db.prepare('SELECT 1 FROM receipts WHERE request_id=?').get(command.request.requestId)).toBeUndefined();
  expect(f.db.isTransaction).toBe(false);
  if (stage !== 'version') { f.db.exec('DROP TRIGGER reject_cancel'); expect(cancel(f, command)).toMatchObject({ state: 'cancelled', version: 2 }); }
});

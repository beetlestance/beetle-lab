import { expect, it } from 'vitest';
import { Worker } from 'node:worker_threads';
import { once } from 'node:events';
import { DatabaseSync } from 'node:sqlite';
import { storageFixture, seed, uuid, scope, settingsFixture, observation, requestId } from './fixture.js';
import { append, createSuite } from './suites-fixture.js';
import { runOptions, runCommand } from './runs-fixture.js';
import { cancelCommand } from './run-cancellation-fixtures.js';
import { snapshotFor } from './execution-foundation-fixtures.js';
import type { Reply } from '../../src/adapters/outbound/sqlite/protocol.js';

const fixture = storageFixture();
function claimOptions() {
  const values = settingsFixture();
  values.chain.installation.values.pool.storageBytes = 200000;
  values.runtime.pool.storageBytes = 400000;
  return { installation: values.chain.installation, runtime: observation(values.runtime), ...runOptions() };
}
it.each(['cancel_first', 'claim_first'] as const)('serializes compiled worker cancellation and claim: %s', order => {
  return race(order);
});

async function race(order: 'cancel_first' | 'claim_first') {
  const path = fixture.path(); const metadata = await fixture.open(path, claimOptions()); await seed(metadata);
  const revision = await append(metadata, await createSuite(metadata));
  const original = runCommand(revision.id);
  const run = await metadata.runs.execute(original);
  const key = (await metadata.dispatch.scan({ lane: 'queued', limit: 1 })).items[0]!.key;
  const command = cancelCommand(run.id);
  const operations = order === 'cancel_first'
    ? [metadata.runs.cancel(command), metadata.dispatch.claim(key)]
    : [metadata.dispatch.claim(key), metadata.runs.cancel(command)];
  const result = await Promise.all(operations);
  if (order === 'cancel_first') {
    expect(result[0]).toMatchObject({ state: 'cancelled', version: 2 });
    expect(result[1]).toEqual({ kind: 'blocked', reason: 'not_queued' });
    expect(await metadata.dispatch.scan({ lane: 'reconcile', limit: 1 })).toMatchObject({ items: [] });
  } else {
    expect(result[0]).toMatchObject({ kind: 'claimed' });
    expect(result[1]).toMatchObject({ state: 'dispatching', version: 3, cancellationRequested: true });
    await metadata.dispatch.observe({ key, journalAuthority: '33333333-3333-4333-8333-333333333333', snapshot: snapshotFor(key) });
    expect(await metadata.runs.getRun({ scope, id: run.id })).toMatchObject({ state: 'active', version: 4, cancellationRequested: true });
  }
  expect(await metadata.runs.cancel(command)).toEqual(result[order === 'cancel_first' ? 0 : 1]);
  expect(await metadata.runs.execute(original)).toEqual(run);
  await fixture.close(metadata);
  const db = new DatabaseSync(path);
  try {
    const retained = order === 'claim_first' ? 1 : 0;
    expect(db.prepare('SELECT count(*) n FROM execution_records WHERE execution_charged=1').get()?.n).toBe(retained);
    expect(db.prepare('SELECT count(*) n FROM attempt_output_allocations').get()?.n).toBe(retained);
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  } finally { db.close(); }
}

it('reopens after a committed but discarded reply and replays the original receipt without capacity', async () => {
  const path = fixture.path(); let metadata = await fixture.open(path, runOptions()); await seed(metadata);
  const revision = await append(metadata, await createSuite(metadata)); const run = await metadata.runs.execute(runCommand(revision.id));
  const command = cancelCommand(run.id);
  // Drop worker-to-Metadata delivery after commit, while retaining a test-only commit witness.
  const channel = (metadata as unknown as { worker: Worker }).worker;
  channel.removeAllListeners('message');
  const committed = once(channel, 'message');
  const lost = expect(metadata.runs.cancel(command)).rejects.toMatchObject({ code: 'unavailable' });
  expect((await committed)[0]).toMatchObject({ kind: 'result', ok: true });
  await metadata.abort(); await lost;
  const db = new DatabaseSync(path);
  const receipt = db.prepare('SELECT result_json FROM receipts WHERE request_id=?').get(command.request.requestId)!;
  const original = JSON.parse(String(receipt.result_json)) as unknown;
  expect(db.prepare('SELECT count(*) n FROM dispatch_outbox').get()?.n).toBe(0);
  expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]); db.close();
  metadata = await fixture.open(path, { runtime: null });
  expect(await metadata.runs.cancel(command)).toEqual(original);
  expect(await metadata.runs.cancel(cancelCommand(run.id))).toEqual(original);
});

it('rejects malformed/cross-scope/conflicting commands without mutating the run', async () => {
  const metadata = await fixture.open(undefined, runOptions()); await seed(metadata);
  const revision = await append(metadata, await createSuite(metadata));
  const create = runCommand(revision.id); const run = await metadata.runs.execute(create);
  const command = cancelCommand(run.id);
  await expect(metadata.runs.cancel({ ...command, intentDigest: 'f'.repeat(64) })).rejects.toMatchObject({ code: 'invalid_input' });
  await expect(metadata.runs.cancel({ ...command, extra: 1 } as never)).rejects.toMatchObject({ code: 'invalid_input' });
  const wrong = cancelCommand(run.id, { scope: { ...scope, workspaceId: uuid(99) }, requestId: requestId() });
  await expect(metadata.runs.cancel(wrong)).rejects.toMatchObject({ code: 'not_found' });
  await expect(metadata.runs.cancel(cancelCommand(run.id, { scope, requestId: create.request.requestId })))
    .rejects.toMatchObject({ code: 'conflict' });
  expect(await metadata.runs.getRun({ scope, id: run.id })).toEqual(run);
  await expect(metadata.runs.cancel(command)).resolves.toMatchObject({ state: 'cancelled' });
  expect(await metadata.runs.getRun({ scope, id: run.id })).toMatchObject({ state: 'cancelled', version: 2 });
  await expect(metadata.runs.cancel(cancelCommand(uuid(71), command.request))).rejects.toMatchObject({ code: 'conflict' });
});

it('validates cancellation digest again at the compiled worker boundary', async () => {
  const path = fixture.path(); const metadata = await fixture.open(path, runOptions()); await seed(metadata);
  const revision = await append(metadata, await createSuite(metadata)); const run = await metadata.runs.execute(runCommand(revision.id));
  await fixture.close(metadata);
  const worker = new Worker(fixture.workerUrl(), { workerData: { path, bootstrap: {
    installation: settingsFixture().chain.installation, runtime: observation(), ...runOptions() } } });
  try {
    expect((await once(worker, 'message'))[0]).toEqual({ kind: 'ready' });
    const next = once(worker, 'message');
    worker.postMessage({ kind: 'cancelRun', command: { ...cancelCommand(run.id), intentDigest: 'f'.repeat(64) }, messageId: 1 });
    expect((await next)[0] as Reply).toMatchObject({ ok: false, code: 'invalid_value', messageId: 1 });
  } finally { await worker.terminate(); }
  const db = new DatabaseSync(path);
  try {
    expect(db.prepare('SELECT state,cancellation_requested,version FROM runs').get())
      .toMatchObject({ state: 'queued', cancellation_requested: 0, version: 1 });
  } finally { db.close(); }
});

it('rolls back compiled worker retirement when saving the cancellation receipt fails', async () => {
  const path = fixture.path(); let metadata = await fixture.open(path, runOptions()); await seed(metadata);
  const revision = await append(metadata, await createSuite(metadata)); const run = await metadata.runs.execute(runCommand(revision.id));
  await fixture.close(metadata);
  let db = new DatabaseSync(path);
  db.exec("CREATE TRIGGER reject_receipt BEFORE INSERT ON receipts BEGIN SELECT RAISE(ABORT,'synthetic receipt failure'); END;"); db.close();
  metadata = await fixture.open(path, { runtime: null }); const command = cancelCommand(run.id);
  await expect(metadata.runs.cancel(command)).rejects.toMatchObject({ code: 'conflict' });
  expect(await metadata.runs.getRun({ scope, id: run.id })).toEqual(run);
  await fixture.close(metadata); db = new DatabaseSync(path);
  try {
    expect(db.prepare('SELECT possible_delivery FROM dispatch_outbox').get()?.possible_delivery).toBe(0);
    expect(db.prepare('SELECT 1 FROM receipts WHERE request_id=?').get(command.request.requestId)).toBeUndefined();
    db.exec('DROP TRIGGER reject_receipt');
  } finally { db.close(); }
  metadata = await fixture.open(path, { runtime: null });
  expect(await metadata.runs.cancel(command)).toMatchObject({ state: 'cancelled', validationStatus: 'pending', version: 2 });
});

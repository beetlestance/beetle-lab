import { expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { observation, seed, settingsFixture, storageFixture } from '../fixture.js';
import { append, createSuite } from '../suites-fixture.js';
import { runCommand, runOptions, runRequest } from '../runs-fixture.js';
import { snapshotFor } from '../execution-foundation-fixtures.js';
import type { Metadata } from '../../../src/adapters/outbound/sqlite/index.js';
import type { EventBinding } from '../../../src/ports/events.js';
import { request, ack } from './fixtures.js';
import { large, grow } from './large-fixtures.js';
const fixture = storageFixture();
function options() {
  const values = settingsFixture();
  values.chain.installation.values.pool.storageBytes = 1_000_000;
  values.chain.installation.values.pool.outputBytes = 100000;
  values.chain.installation.values.perRunCeilings.outputBytes = 100000;
  values.runtime.pool.storageBytes = 2_000_000; values.runtime.pool.outputBytes = 200000;
  values.runtime.perRun.outputBytes = 200000;
  return { installation: values.chain.installation, runtime: observation(values.runtime), ...runOptions() };
}
async function original(metadata: Metadata): Promise<EventBinding> {
  await seed(metadata); const revision = await append(metadata, await createSuite(metadata));
  const body = runRequest(revision.id); body.budget.outputBytes = 100000;
  await metadata.runs.execute(runCommand(revision.id, 70, body));
  const key = (await metadata.dispatch.scan({ lane: 'queued', limit: 1 })).items[0]!.key;
  await metadata.dispatch.claim(key);
  const binding = { key, journalAuthority: '33333333-3333-4333-8333-333333333333' };
  await metadata.dispatch.observe({ ...binding, snapshot: snapshotFor(key, { lastSeq: 900 }) });
  return binding;
}
it('carries all five methods through the compiled worker; snapshot sequence never supplies events', async () => {
  const path = fixture.path(); let metadata = await fixture.open(path, options());
  const binding = await original(metadata);
  expect(await metadata.events.load(binding)).toMatchObject({ durableThrough: 0, eventCount: 0, retainedBytes: 0 });
  expect(await metadata.events.ingest(request(binding, 0, 100))).toMatchObject({ inserted: 100, ackThrough: 100 });
  await expect(metadata.events.ingest(request(binding, 0, 101))).rejects.toMatchObject({ code: 'invalid_input' });
  expect(await metadata.events.scan({ limit: 1 })).toMatchObject({ items: [{ kind: 'ready', binding }] });
  await expect(metadata.events.confirmAck({ binding, throughSeq: 100, receipt: ack(binding, 101) })).rejects.toMatchObject({ code: 'invalid_input' });
  const blocked = await metadata.events.recordProblem({ binding, after: 100, kind: 'missing_receipt' });
  expect(blocked.blockedReason).toBe('missing_receipt');
  const confirming = metadata.events.confirmAck({ binding, throughSeq: 100, receipt: ack(binding, 100) });
  const closing = fixture.close(metadata);
  expect(await confirming).toMatchObject({ ackConfirmedThrough: 100, durableThrough: 100, blockedReason: 'missing_receipt' });
  await closing;
  metadata = await fixture.open(path, { ...options(), runtime: null });
  expect(await metadata.events.load(binding)).toMatchObject({ ackConfirmedThrough: 100, durableThrough: 100, eventCount: 100 });
  await fixture.close(metadata);
  const db = new DatabaseSync(path);
  try {
    expect(db.prepare('SELECT count(*) n,sum(charged_bytes) bytes FROM run_events').get()).toMatchObject({ n: 100 });
    expect(db.prepare('SELECT charged_bytes FROM installation_storage_usage').get()?.charged_bytes).toBe(231072);
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  } finally { db.close(); }
});
it('reconciles a committed withheld ingest reply after termination without inventing ACK or recharging rows', async () => {
  const path = fixture.path(); let metadata = await fixture.open(path, options()); const binding = await original(metadata);
  const receive = Reflect.get(metadata, 'receive') as (reply: unknown) => void;
  let sawCommit!: () => void; const committed = new Promise<void>(resolve => { sawCommit = resolve; });
  Reflect.set(metadata, 'receive', (reply: unknown) => {
    if (reply !== null && typeof reply === 'object' && Reflect.get(reply, 'kind') === 'result' && Reflect.get(reply, 'ok') === true) sawCommit();
    else receive.call(metadata, reply);
  });
  const issued = metadata.events.ingest(request(binding, 0, 3));
  const rejected = expect(issued).rejects.toMatchObject({ code: 'unavailable' });
  await committed; await metadata.abort(); fixture.handles.delete(metadata); await rejected;
  metadata = await fixture.open(path, { ...options(), runtime: null });
  const state = await metadata.events.load(binding);
  expect(state).toMatchObject({ durableThrough: 3, eventCount: 3, ackConfirmedThrough: 0 });
  expect(await metadata.events.ingest(request(binding, 0, 3))).toEqual({ state, inserted: 0, ackThrough: 3 });
  expect(await metadata.events.confirmAck({ binding, throughSeq: 3, receipt: ack(binding, 3) })).toMatchObject({ ackConfirmedThrough: 3 });
});

it('keeps the maximum original batch intact across parent and compiled worker despite its carrier overhead', async () => {
  const metadata = await fixture.open(undefined, options()); const binding = await original(metadata);
  const batch = large(binding); grow(batch, 262144);
  expect(await metadata.events.ingest({ binding, after: 0, batch })).toMatchObject({ inserted: 0,
    state: { blockedReason: 'quota_exhausted', durableThrough: 0 } });
  expect(await metadata.events.ingest({ binding, after: 0, batch: large(binding, 10) })).toMatchObject({ inserted: 0,
    state: { blockedReason: 'quota_exhausted', durableThrough: 0 } });
});

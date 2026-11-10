import { expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { Worker } from 'node:worker_threads';
import { encodeCanonicalJson } from '@beetle/contracts';
import { prepareCancelRunCommand } from '../../src/application/runs/index.js';
import { captureFinalizationOperation, captureFinalizationReply } from '../../src/adapters/outbound/sqlite/output-finalization/index.js';
import type { OutputFinalizationRequest } from '../../src/ports/output-finalization.js';
import { storageFixture, settingsFixture, observation, requestId, digest } from '../storage/fixture.js';
import { guardsOff } from '../run-results/fixture.js';
import { finalizationFixture, uuid, scope } from './fixture.js';
const storage = storageFixture();

it('recovers a lost committed compiled-worker reply after reopening with exactly one original credit and immutable terminal projection', async () => {
  const f = finalizationFixture(); f.ready(); const path = storage.path(); f.db.prepare('VACUUM INTO ?').run(path);
  const original = f.command(); const before = f.usage();
  const worker = new Worker(storage.workerUrl(), { workerData: { path, bootstrap: {
    installation: settingsFixture().chain.installation, runtime: observation(), runs: f.config } } });
  try {
    // Discard the committed result: no caller receives a usable finalization ACK.
    await new Promise<void>((resolve, reject) => {
      worker.once('error', reject);
      worker.on('message', (message: { kind: string; ok?: boolean }) => {
        if (message.kind === 'ready') worker.postMessage({ kind: 'outputFinalize', request: original, messageId: 1 });
        else if (message.kind === 'result' && message.ok) resolve();
        else reject(new Error('Compiled worker did not commit'));
      });
    });
  } finally { await worker.terminate(); }
  let metadata = await storage.open(path, { runtime: null, runs: f.config });
  const replay = await metadata.finalizations.finalize({ ...original, expectedRunVersion: 1 });
  expect(replay).toMatchObject({ kind: 'finalized', receipt: { state: 'finished', runVersion: original.expectedRunVersion + 1 } });
  if (replay.kind !== 'finalized') throw new Error('Missing committed receipt');
  expect((await metadata.inputs.storage()).chargedBytes).toBe(before - replay.receipt.refundedBytes);
  expect(await metadata.outputs.scan({ limit: 32 })).toEqual({ items: [], nextCursor: null });
  expect((await metadata.results.getRunResult({ id: f.key.runId, scope })).result).toEqual(f.envelope.manifest.result);
  await storage.close(metadata);
  const db = new DatabaseSync(path);
  try {
    expect(db.prepare('SELECT count(*) n FROM execution_output_finalizations').get()?.n).toBe(1);
    expect(db.prepare('SELECT count(*) n FROM execution_output_payloads').get()?.n).toBe(1);
    expect(db.prepare('SELECT sum(charged_bytes) bytes FROM attempt_output_allocations').get()?.bytes).toBe(75536);
    expect(db.prepare('SELECT charged_bytes FROM installation_storage_usage').get()?.charged_bytes)
      .toBe(75536 - replay.receipt.refundedBytes);
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  } finally { db.close(); }
  metadata = await storage.open(path, { runtime: null });
  expect(await metadata.finalizations.finalize(original)).toEqual(replay);
  await expect(metadata.finalizations.finalize({ ...original, sourceDigest: 'a'.repeat(64) })).rejects.toMatchObject({ code: 'conflict' });
});

it.each(['cancel-first', 'finalize-first'] as const)('serializes cancellation race in the actual compiled worker: %s', async order => {
  const f = finalizationFixture(); f.ready(); const path = storage.path(); f.db.prepare('VACUUM INTO ?').run(path);
  const metadata = await storage.open(path, { runs: f.config });
  const cancel = prepareCancelRunCommand({ kind: 'cancelRun', id: f.key.runId, request: { scope, requestId: requestId() } }, digest);
  const finalize = () => metadata.finalizations.finalize(f.command());
  if (order === 'cancel-first') {
    const cancelled = metadata.runs.cancel(cancel); const first = finalize();
    const run = await cancelled; expect(run.cancellationRequested).toBe(true);
    // The finalizer carries the pre-cancel version and must retry the same binding.
    await expect(first).rejects.toMatchObject({ code: 'conflict' });
    const current = await metadata.runs.getRun({ id: f.key.runId, scope });
    expect(await metadata.finalizations.finalize({ ...f.command(), expectedRunVersion: current.version })).toMatchObject({
      kind: 'finalized', receipt: { state: 'cancelled', reason: 'cancelled', validationStatus: 'passed' } });
  } else {
    const first = finalize(); const cancelled = metadata.runs.cancel(cancel);
    expect(await first).toMatchObject({ kind: 'finalized', receipt: { state: 'finished', outcome: 'passed' } });
    expect(await cancelled).toMatchObject({ state: 'finished', cancellationRequested: false });
  }
  const once = (await metadata.inputs.storage()).chargedBytes;
  const run = await metadata.runs.getRun({ id: f.key.runId, scope });
  await metadata.finalizations.finalize({ ...f.command(), expectedRunVersion: run.version });
  expect((await metadata.inputs.storage()).chargedBytes).toBe(once);
});

it('captures the ordinary <=4096-byte operation/reply at both worker seams and rejects fake terminal replies', async () => {
  const f = finalizationFixture(); f.ready(); const operation = { kind: 'outputFinalize' as const, request: f.command() };
  expect(captureFinalizationOperation({ ...operation, messageId: 1 })).toEqual(operation);
  const good = f.finalize(); expect(captureFinalizationReply(operation, good)).toEqual(good);
  if (good.kind !== 'finalized') throw new Error('Missing receipt');
  expect(Buffer.byteLength(encodeCanonicalJson(good, 4096))).toBeLessThanOrEqual(4096);
  for (const patch of [{ outcome: 'pending' }, { state: 'finished', validationStatus: 'pending' }, { reason: 'cancelled' },
    { runVersion: 1 }, { refundedBytes: -1 }, { retainedPayloadBytes: Number.MAX_SAFE_INTEGER }, { sourceDigest: 'f'.repeat(64) },
    { binding: { ...f.binding, journalAuthority: uuid(88) } }]) {
    expect(() => captureFinalizationReply(operation, { ...good, receipt: { ...good.receipt, ...patch } })).toThrow();
  }
  const path = storage.path(); const g = finalizationFixture(); g.ready(); g.db.prepare('VACUUM INTO ?').run(path);
  const metadata = await storage.open(path, { runs: g.config });
  for (const request of [{ ...g.command(), extra: true }, { ...g.command(), expectedRunVersion: 0 },
    { ...g.command(), sourceDigest: 'z'.repeat(64) }, { ...g.command(), padding: 'x'.repeat(4096) },
    { ...g.command(), binding: { ...g.binding, key: { ...g.key, attempt: { ...g.key.attempt, generation: 2 } } } }]) {
    await expect(metadata.finalizations.finalize(request as OutputFinalizationRequest)).rejects.toMatchObject({ code: 'invalid_input' });
  }
  const accessor = Object.defineProperty({}, 'binding', { enumerable: true, get: () => { throw new Error('Accessor invoked'); } });
  await expect(metadata.finalizations.finalize(accessor as OutputFinalizationRequest)).rejects.toMatchObject({ code: 'invalid_input' });
});

it('rejects corruption through the compiled worker and malformed ingress without a successful fallback', async () => {
  const f = finalizationFixture(); f.ready(); guardsOff(f.db, 'execution_output_payloads');
  f.db.exec("UPDATE execution_output_payloads SET canonical_json=json_set(canonical_json,'$.result.seal.sha256','0000000000000000000000000000000000000000000000000000000000000000')");
  const path = storage.path(); f.db.prepare('VACUUM INTO ?').run(path);
  const metadata = await storage.open(path, { runs: f.config });
  await expect(metadata.finalizations.finalize(f.command())).rejects.toMatchObject({ code: 'unavailable' });
  await metadata.abort(); storage.handles.delete(metadata);
  const worker = new Worker(storage.workerUrl(), { workerData: { path, bootstrap: {
    installation: settingsFixture().chain.installation, runtime: observation(), runs: f.config } } });
  try {
    const reply = await new Promise<unknown>((resolve, reject) => {
      worker.once('error', reject);
      worker.on('message', (message: { kind: string }) => {
        if (message.kind === 'ready') worker.postMessage({ kind: 'outputFinalize', messageId: 1, request: f.command(), extra: true });
        else resolve(message);
      });
    });
    expect(reply).toEqual({ kind: 'result', messageId: 1, ok: false, code: 'invalid_input' });
  } finally { await worker.terminate(); }
});

it('keeps finalization in the ordinary RPC lane alongside both occupied large-original slots', async () => {
  const f = finalizationFixture(); f.ready(); const path = storage.path(); f.db.prepare('VACUUM INTO ?').run(path);
  const metadata = await storage.open(path, { runs: f.config });
  const source = metadata.outputs.readSource(f.binding);
  const result = metadata.results.getRunResult({ id: f.key.runId, scope });
  const command = f.command(); const finalization = metadata.finalizations.finalize(command);
  command.sourceDigest = 'f'.repeat(64);
  await expect(metadata.outputs.readSource(f.binding)).rejects.toMatchObject({ code: 'queue_full' });
  expect(await source).toEqual(f.envelope);
  expect((await result).result).toEqual(f.envelope.manifest.result);
  expect(await finalization).toMatchObject({ kind: 'finalized', receipt: { sourceDigest: f.envelope.sourceDigest } });
});

it('rejects the header2/end1 contradiction through the compiled RPC without changing Run, usage or discovery', async () => {
  const f = finalizationFixture({ events: 1 }); f.ready(); const path = storage.path(); f.db.prepare('VACUUM INTO ?').run(path);
  const metadata = await storage.open(path, { runs: f.config });
  const before = await Promise.all([metadata.runs.getRun({ id: f.key.runId, scope }), metadata.inputs.storage(),
    metadata.outputs.scan({ limit: 32 }), metadata.events.scan({ limit: 32 })]);
  await expect(metadata.finalizations.finalize(f.command())).rejects.toMatchObject({ code: 'conflict' });
  expect(await Promise.all([metadata.runs.getRun({ id: f.key.runId, scope }), metadata.inputs.storage(),
    metadata.outputs.scan({ limit: 32 }), metadata.events.scan({ limit: 32 })])).toEqual(before);
  await storage.close(metadata);
  const db = new DatabaseSync(path);
  try {
    expect(db.prepare('SELECT count(*) n FROM execution_output_finalizations').get()?.n).toBe(0);
    expect(db.prepare('SELECT event_pending FROM execution_records').get()?.event_pending).toBe(1);
  } finally { db.close(); }
});

import { expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { Worker } from 'node:worker_threads';
import { absenceFixture } from './fixture.js';
import { storageFixture, settingsFixture, observation, scope, requestId, digest } from '../storage/fixture.js';
import { prepareCancelRunCommand } from '../../src/application/runs/index.js';
import type { OutputAbsenceFinalizeRequest } from '../../src/ports/output-absence.js';
const storage = storageFixture();
it('compiled Metadata adopts, retains/reopens and replays lost committed reply with one exact credit', async () => {
  const f = absenceFixture(); f.release({ result: f.value }); f.ingest(); f.confirm();
  const path = storage.path(); f.db.prepare('VACUUM INTO ?').run(path);
  let metadata = await storage.open(path, { runs: f.config });
  expect(await metadata.absences.read(f.binding)).toBeNull();
  const state = await metadata.absences.adopt({ binding: f.binding, closure: f.proof });
  expect(await metadata.absences.adopt({ binding: f.binding, closure: f.proof })).toEqual(state);
  await storage.close(metadata);
  const command = { binding: f.binding, proofDigest: state.proofDigest, expectedRunVersion: f.command().expectedRunVersion };
  const worker = new Worker(storage.workerUrl(), { workerData: { path, bootstrap: {
    installation: settingsFixture().chain.installation, runtime: observation(), runs: f.config } } });
  try {
    await new Promise<void>((resolve, reject) => {
      worker.once('error', reject); worker.on('message', (message: { kind: string; ok?: boolean }) => {
        if (message.kind === 'ready') worker.postMessage({ kind: 'absenceFinalize', request: command, messageId: 1 });
        else if (message.kind === 'result' && message.ok) resolve(); else reject(new Error('Compiled commit failed'));
      });
    });
  } finally { await worker.terminate(); }
  metadata = await storage.open(path, { runs: f.config });
  const replay = await metadata.absences.finalize({ ...command, expectedRunVersion: 1 });
  expect(replay).toMatchObject({ kind: 'finalized', receipt: { state: 'errored', outcome: 'inconclusive', validationStatus: 'pending' } });
  if (replay.kind !== 'finalized') throw new Error('Missing receipt');
  expect((await metadata.inputs.storage()).chargedBytes).toBe(f.usage() - replay.receipt.refundedBytes);
  expect(await metadata.absences.read(f.binding)).toEqual(state);
  expect(await metadata.outputs.scan({ limit: 32 })).toEqual({ items: [], nextCursor: null });
  expect(await metadata.events.scan({ limit: 32 })).toEqual({ items: [], nextCursor: null });
  expect(await metadata.absences.finalize(command)).toEqual(replay);
  await storage.close(metadata);
  const db = new DatabaseSync(path);
  try {
    expect(db.prepare('SELECT count(*) n FROM execution_output_absence_finalizations').get()?.n).toBe(1);
    expect(db.prepare('SELECT count(*) n FROM execution_output_finalizations').get()?.n).toBe(0);
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  } finally { db.close(); }
});
it.each(['cancel-first', 'finalize-first'] as const)('compiled cancellation serializes %s', async order => {
  const f = absenceFixture(); f.ready(); const path = storage.path(); f.db.prepare('VACUUM INTO ?').run(path);
  const metadata = await storage.open(path, { runs: f.config }); const original = f.command();
  const cancel = prepareCancelRunCommand({ kind: 'cancelRun', id: f.key.runId, request: { scope, requestId: requestId() } }, digest);
  if (order === 'cancel-first') {
    const cancelled = metadata.runs.cancel(cancel); const finalizing = metadata.absences.finalize(original);
    await cancelled; await expect(finalizing).rejects.toMatchObject({ code: 'conflict' });
    const current = await metadata.runs.getRun({ id: f.key.runId, scope });
    expect(await metadata.absences.finalize({ ...original, expectedRunVersion: current.version })).toMatchObject({
      kind: 'finalized', receipt: { state: 'cancelled', reason: 'cancelled', validationStatus: 'pending' } });
  } else {
    const finalizing = metadata.absences.finalize(original); const cancelled = metadata.runs.cancel(cancel);
    expect(await finalizing).toMatchObject({ kind: 'finalized', receipt: { state: 'errored' } });
    expect(await cancelled).toMatchObject({ state: 'errored', cancellationRequested: false });
  }
});
it('compiled RPC enforces ordinary bounds and captures caller values before posting', async () => {
  const f = absenceFixture(); f.ready(); const path = storage.path(); f.db.prepare('VACUUM INTO ?').run(path);
  const metadata = await storage.open(path, { runs: f.config }); const command = f.command();
  const pending = metadata.absences.finalize(command); command.proofDigest = 'f'.repeat(64);
  expect(await pending).toMatchObject({ kind: 'finalized' });
  for (const request of [{ ...f.command(), extra: true }, { ...f.command(), padding: 'x'.repeat(4096) },
    { ...f.command(), expectedRunVersion: 0 }, { ...f.command(), proofDigest: 'z'.repeat(64) }]) {
    await expect(metadata.absences.finalize(request as OutputAbsenceFinalizeRequest)).rejects.toMatchObject({ code: 'invalid_input' });
  }
});

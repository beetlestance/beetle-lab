import { expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { Worker } from 'node:worker_threads';
import { encodeJson } from '@beetle/contracts';
import type { RunKey } from '../../src/ports/runs.js';
import { captureResultOperation, captureResultReply } from '../../src/adapters/outbound/sqlite/run-results/index.js';
import { storageFixture, observation, settingsFixture } from '../storage/fixture.js';
import { fixture, guardsOff, keyFor, largeFixture, scope, uuid } from './fixture.js';
const storage = storageFixture();

it('carries a >64KiB verified result through both compiled-worker captures, shares the two-original lane, and reopens one body', async () => {
  const f = largeFixture(); const path = storage.path(); f.db.prepare('VACUUM INTO ?').run(path);
  let metadata = await storage.open(path, { runs: f.config });
  const key = keyFor(f.key.runId);
  expect((await metadata.results.getRunResult(key)).result).toBeNull();
  await metadata.outputs.adopt({ binding: f.binding, envelope: f.envelope });
  const original = structuredClone(key);
  const first = metadata.results.getRunResult(key);
  const second = metadata.outputs.readSource(f.binding);
  await expect(metadata.results.getRunResult(key)).rejects.toMatchObject({ code: 'queue_full' });
  key.id = uuid(999); key.scope = { ...scope, workspaceId: uuid(999) };
  const value = await first;
  expect(Buffer.byteLength(encodeJson(value, 73728))).toBeGreaterThan(65536);
  expect(value).toEqual({ ...original, activeAttemptId: f.key.attempt.attemptId, result: f.envelope.manifest.result });
  expect(await second).toEqual(f.envelope);
  value.result!.artifacts[0]!.relativePath = 'mutated-client-copy';
  expect((await metadata.results.getRunResult(original)).result).toEqual(f.envelope.manifest.result);
  await expect(metadata.results.getRunResult({ ...original, scope: { ...scope, organizationId: uuid(99) } }))
    .rejects.toMatchObject({ code: 'not_found' });
  await expect(metadata.results.getRunResult({ ...original, extra: true } as RunKey)).rejects.toMatchObject({ code: 'invalid_input' });
  const accessor = Object.defineProperty({}, 'scope', { enumerable: true, get: () => { throw new Error('Accessor invoked'); } }) as RunKey;
  await expect(metadata.results.getRunResult(accessor)).rejects.toMatchObject({ code: 'invalid_input' });
  await storage.close(metadata);
  const db = new DatabaseSync(path);
  try {
    expect(db.prepare('SELECT count(*) n FROM execution_output_payloads').get()?.n).toBe(1);
    expect(db.prepare('SELECT count(*) n FROM execution_output_sources').get()?.n).toBe(1);
    expect(db.prepare('SELECT outcome,validation_status FROM runs').get()).toEqual({ outcome: 'pending', validation_status: 'pending' });
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  } finally { db.close(); }
  metadata = await storage.open(path, { runtime: null, runs: { profiles: [], pendingLimit: 1 } });
  expect((await metadata.results.getRunResult(original)).result).toEqual(f.envelope.manifest.result);
});

it('rejects a damaged source through the compiled worker with no null fallback', async () => {
  const f = fixture(); f.adopt(); guardsOff(f.db, 'execution_output_payloads');
  f.db.exec('DELETE FROM execution_output_payloads');
  const path = storage.path(); f.db.prepare('VACUUM INTO ?').run(path);
  const metadata = await storage.open(path, { runs: f.config });
  await expect(metadata.results.getRunResult(keyFor(f.key.runId))).rejects.toMatchObject({ code: 'unavailable' });
});

it('captures bounded readonly RPC requests/replies and checks schema, ownership, generation and seal', () => {
  const f = fixture(); const key = keyFor(f.key.runId);
  expect(captureResultOperation({ kind: 'getRunResult', key, messageId: 1 })).toEqual({ kind: 'getRunResult', key });
  for (const input of [{ kind: 'getRunResult', key, extra: true }, { kind: 'getRunResult', key, messageId: 0 },
    { kind: 'getRunResult', key: { ...key, padding: 'x'.repeat(4096) } }]) {
    expect(() => captureResultOperation(input)).toThrow();
  }
  const good = { id: key.id, scope, activeAttemptId: f.key.attempt.attemptId, result: f.envelope.manifest.result };
  expect(captureResultReply(key, good)).toEqual(good);
  for (const input of [{ ...good, padding: 'x'.repeat(73728) }, { ...good, journalAuthority: f.binding.journalAuthority },
    { ...good, id: uuid(999) }, { ...good, activeAttemptId: uuid(999) },
    { ...good, result: { ...good.result, workspaceId: uuid(999) } },
    { ...good, result: { ...good.result, generation: 2 } },
    { ...good, result: { ...good.result, seal: { ...good.result.seal, sha256: 'f'.repeat(64) } } }]) {
    expect(() => captureResultReply(key, input)).toThrow();
  }
});

it('validates malformed operation fields at the actual worker ingress', async () => {
  const f = fixture(); const path = storage.path(); f.db.prepare('VACUUM INTO ?').run(path);
  const worker = new Worker(storage.workerUrl(), { workerData: { path,
    bootstrap: { installation: settingsFixture().chain.installation, runtime: observation(), runs: f.config } } });
  try {
    const reply = await new Promise<unknown>((resolve, reject) => {
      worker.once('error', reject);
      worker.on('message', (message: { kind: string }) => {
        if (message.kind === 'ready') worker.postMessage({ kind: 'getRunResult', messageId: 1, key: keyFor(f.key.runId), extra: true });
        else resolve(message);
      });
    });
    expect(reply).toEqual({ kind: 'result', messageId: 1, ok: false, code: 'invalid_input' });
  } finally { await worker.terminate(); }
});

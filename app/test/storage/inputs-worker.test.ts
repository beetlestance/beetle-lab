import { expect, it } from 'vitest';
import { Worker } from 'node:worker_threads';
import type { InputRecord } from '../../src/ports/inputs.js';
import type { Reply, Operation } from '../../src/adapters/outbound/sqlite/protocol.js';
import { storageFixture, seed, scope, uuid } from './fixture.js';
import { createInput, inputOptions } from './inputs-fixture.js';

const fixture = storageFixture();
function receive(worker: Worker): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { cleanup(); reject(new Error('Worker reply deadline')); }, 5000);
    const message = (reply: Reply) => { cleanup(); resolve(reply); };
    const error = (value: Error) => { cleanup(); reject(value); };
    function cleanup() { clearTimeout(timer); worker.off('message', message); worker.off('error', error); }
    worker.once('message', message); worker.once('error', error);
  });
}
it('revalidates real worker dequeue controls and advances independently of caller validation', async () => {
  const path = fixture.path(); const metadata = await fixture.open(path, inputOptions()); await seed(metadata); await fixture.close(metadata);
  const worker = new Worker(fixture.workerUrl(), { workerData: { path, bootstrap: inputOptions() }, resourceLimits: { maxOldGenerationSizeMb: 128 } });
  try {
    expect(await receive(worker)).toEqual({ kind: 'ready' });
    let messageId = 0;
    async function send(operation: Operation): Promise<Reply> {
      const result = receive(worker); worker.postMessage({ ...operation, messageId: ++messageId }); return result;
    }
    const create = createInput();
    const rejected = await send({ kind: 'input', command: { ...create, intentDigest: 'b'.repeat(64) } });
    expect(rejected).toMatchObject({ kind: 'result', ok: false, code: 'invalid_value' });
    expect(JSON.stringify(rejected)).not.toContain(path);
    const admitted = await send({ kind: 'input', command: create });
    expect(admitted).toMatchObject({ kind: 'result', ok: true, value: { id: create.id, state: 'staging' } });
    await expect(send({ kind: 'advanceInput', command: { kind: 'commitInputOffset', key: { scope, id: create.id }, expectedVersion: 1, offset: 8388609 } }))
      .resolves.toMatchObject({ kind: 'result', ok: false, code: 'invalid_value' });
    expect(await send({ kind: 'getInput', key: { scope, id: create.id } })).toMatchObject({ kind: 'result', ok: true, value: { offset: 0, version: 1 } });
    expect(await send({ kind: 'close' })).toMatchObject({ kind: 'result', ok: true });
  } finally { await worker.terminate(); }
});
it('keeps input queue capacity bounded, reserves close, and preserves admitted writes across reopen', async () => {
  const path = fixture.path(); const metadata = await fixture.open(path, { ...inputOptions(), queueLimit: 1 }); await seed(metadata);
  const create = createInput(); const accepted = metadata.inputs.control(create);
  await expect(metadata.inputs.storage()).rejects.toMatchObject({ code: 'queue_full' });
  const closing = metadata.close();
  await expect(metadata.inputs.get({ scope, id: create.id })).rejects.toMatchObject({ code: 'closed' });
  const input = await accepted as InputRecord; await closing; fixture.handles.delete(metadata);
  const reopened = await fixture.open(path, { ...inputOptions(), runtime: null });
  expect(await reopened.inputs.control(create)).toEqual(input);
  expect((await reopened.inputs.storage()).chargedBytes).toBe(65548);
});
it('rejects injected recovery scope at caller and dequeue while preserving global two-organization paging', async () => {
  const path = fixture.path(); const metadata = await fixture.open(path, inputOptions());
  await seed(metadata); await seed(metadata, 11, 12, 13);
  const foreign = { ...scope, organizationId: uuid(11), workspaceId: uuid(12) };
  await metadata.inputs.control(createInput(90)); await metadata.inputs.control(createInput(91, 12, foreign));
  await expect(metadata.inputs.recovery({ limit: 1, scope } as never)).rejects.toMatchObject({ code: 'invalid_input' });
  await expect(metadata.inputs.list({ limit: 1 } as never)).rejects.toMatchObject({ code: 'invalid_input' });
  const first = await metadata.inputs.recovery({ limit: 1 });
  expect(first.items.map(input => input.scope.organizationId)).toEqual([scope.organizationId]);
  expect(first.nextCursor).toEqual(expect.any(String));
  const second = await metadata.inputs.recovery({ limit: 1, cursor: first.nextCursor! });
  expect(second.items.map(input => input.scope.organizationId)).toEqual([foreign.organizationId]);
  expect(second.nextCursor).toBeNull();
  expect((await metadata.inputs.list({ scope, limit: 2 })).items.map(input => input.id)).toEqual([uuid(90)]);
  await fixture.close(metadata);
  const worker = new Worker(fixture.workerUrl(), { workerData: { path, bootstrap: inputOptions() }, resourceLimits: { maxOldGenerationSizeMb: 128 } });
  try {
    expect(await receive(worker)).toEqual({ kind: 'ready' });
    let messageId = 0;
    async function send(operation: Operation): Promise<Reply> {
      const result = receive(worker); worker.postMessage({ ...operation, messageId: ++messageId }); return result;
    }
    expect(await send({ kind: 'recoverInputs', query: { limit: 1, scope } } as never))
      .toMatchObject({ kind: 'result', ok: false, code: 'invalid_value' });
    expect(await send({ kind: 'listInputs', query: { limit: 1 } } as never))
      .toMatchObject({ kind: 'result', ok: false, code: 'invalid_value' });
    expect(await send({ kind: 'recoverInputs', query: { limit: 1, mode: 'all' } } as never))
      .toMatchObject({ kind: 'result', ok: false, code: 'invalid_value' });
    expect(await send({ kind: 'recoverInputs', query: { limit: 1, mode: 'pending', scope } } as never))
      .toMatchObject({ kind: 'result', ok: false, code: 'invalid_value' });
    expect(await send({ kind: 'recoverInputs', query: { limit: 2, mode: 'pending' } }))
      .toMatchObject({ kind: 'result', ok: true, value: { items: [], nextCursor: null } });
    expect(await send({ kind: 'recoverInputs', query: { limit: 2 } })).toMatchObject({ kind: 'result', ok: true,
      value: { items: [{ id: uuid(90), scope }, { id: uuid(91), scope: foreign }], nextCursor: null } });
    expect(await send({ kind: 'close' })).toMatchObject({ kind: 'result', ok: true });
  } finally { await worker.terminate(); }
});

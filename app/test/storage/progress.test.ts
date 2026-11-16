import { expect, it, vi } from 'vitest';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { command, requestId, storageFixture, uuid } from './fixture.js';

const fixture = storageFixture();
it('drains a durable burst exceeding five seconds while refusing overflow and preserving writes after close', async () => {
  const entry = join(fixture.root(), 'slow-writes.mjs');
  await writeFile(entry, `import {parentPort} from 'node:worker_threads';
    const on = parentPort.on.bind(parentPort);
    parentPort.on = (event, listener) => on(event, event === 'message' ? command => {
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 170); listener(command);
    } : listener);
    await import(${JSON.stringify(fixture.workerUrl().href)});`);
  const path = fixture.path(); const metadata = await fixture.open(path, {workerUrl: pathToFileURL(entry)});
  const writes = Array.from({length: 32}, (_, index) => metadata.namespaces.execute(command({
    kind: 'createOrganization', id: uuid(index + 10), request: {requestId: requestId(),
      scope: {kind: 'installation'}, name: `Org ${index}`, slug: `org-${index}`},
  })));
  await expect(metadata.list({kind: 'organization', scope: {kind: 'installation'}, limit: 100}))
    .rejects.toMatchObject({code: 'queue_full'});
  // Close has its own slot; it must drain the accepted FIFO, not time out in queue.
  const closing = fixture.close(metadata);
  await expect(Promise.all(writes)).resolves.toHaveLength(32); await closing;
  const reopened = await fixture.open(path);
  expect((await reopened.list({kind: 'organization', scope: {kind: 'installation'}, limit: 100})).items).toHaveLength(32);
}, 15000);

it('renews on completion, not enqueue, and stays fenced when diagnostics throw', async () => {
  const entry = join(fixture.root(), 'partial-progress.mjs');
  await writeFile(entry, `import {parentPort} from 'node:worker_threads';
    let first; parentPort.on('message',command=>{
      if (!first) first=command;
      else if (command.messageId===2) parentPort.postMessage({kind:'result',messageId:first.messageId,ok:true,value:null});
    }); parentPort.postMessage({kind:'ready'});`);
  vi.useFakeTimers({toFake:['setTimeout','clearTimeout']});
  const sink = vi.spyOn(process.stderr, 'write').mockImplementation(() => {throw new Error('broken diagnostic sink');});
  let metadata;
  try {
    metadata = await fixture.open(undefined, {workerUrl:pathToFileURL(entry)});
    const first = metadata.updateRuntime(null); await vi.advanceTimersByTimeAsync(4000);
    const second = metadata.updateRuntime(null); const failedSecond=expect(second).rejects.toMatchObject({code:'unavailable'});
    await first; await vi.advanceTimersByTimeAsync(4000);
    const third=metadata.updateRuntime(null); const failedThird=expect(third).rejects.toMatchObject({code:'unavailable'});
    await vi.advanceTimersByTimeAsync(1001); await Promise.all([failedSecond,failedThird]);
    expect(sink).toHaveBeenCalledOnce();
    await expect(metadata.getSettings({kind:'installation'})).rejects.toMatchObject({code:'unavailable'});
    await expect(fixture.close(metadata)).rejects.toMatchObject({code:'unavailable'});
  } finally {sink.mockRestore();vi.useRealTimers();await metadata?.abort();}
});

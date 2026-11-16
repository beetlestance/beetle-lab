import { expect, it, vi } from 'vitest';
import { writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { openJournal } from '../../src/journal/index.js';
import { journalFixture } from './fixtures.js';

const fixture = journalFixture();
it('drains durable cancellations beyond five seconds without false failure or lost writes', async () => {
  const path = fixture.path(); const first = await fixture.open(path);
  const offers = Array.from({length: 32}, (_, index) => ({...fixture.offer(),
    attemptId: `00000000-0000-4000-8001-${String(index + 1).padStart(12, '0')}`}));
  for (const offer of offers) await first.immutableOffer(offer);
  await fixture.close(first);
  const keys = offers.map(({attemptId, organizationId, workspaceId}) => ({attemptId, organizationId, workspaceId}));
  const entry = join(dirname(fileURLToPath(fixture.workerUrl())), 'slow-writes.mjs');
  await writeFile(entry, `import {parentPort} from 'node:worker_threads';
    const on = parentPort.on.bind(parentPort);
    parentPort.on = (event, listener) => on(event, event === 'message' ? command => {
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 170); listener(command);
    } : listener);
    await import(${JSON.stringify(fixture.workerUrl().href)});`);
  const journal = await openJournal({path, workerUrl: pathToFileURL(entry)});
  try {
    const writes = keys.map(key => journal.durableCancel(key));
    await expect(journal.get(keys[0]!)).rejects.toMatchObject({code: 'queue_full'});
    const closing = journal.close();
    const values = await Promise.all(writes); expect(values.every(value => value.cancelRequested)).toBe(true);
    await closing;
  } finally { await journal.abort(); }
  const reopened = await fixture.open(path);
  for (const key of keys) expect((await reopened.get(key)).cancelRequested).toBe(true);
}, 15000);

it('renews only on completion and fails remaining work after a partial-progress stall', async () => {
  const entry=join(dirname(fileURLToPath(fixture.workerUrl())), 'partial-progress.mjs');
  await writeFile(entry, `import {parentPort} from 'node:worker_threads';
    let first; parentPort.on('message',command=>{
      if (!first) first=command;
      else if (command.id===2) parentPort.postMessage({kind:'result',id:first.id,ok:true,value:'33333333-3333-4333-8333-333333333333'});
    }); parentPort.postMessage({kind:'ready'});`);
  vi.useFakeTimers({toFake:['setTimeout','clearTimeout']});
  const sink=vi.spyOn(process.stderr,'write').mockImplementation(()=>{throw new Error('broken diagnostic sink');});
  let journal;
  try {
    journal=await openJournal({path:fixture.path(),workerUrl:pathToFileURL(entry)});
    const first=journal.journalAuthority();await vi.advanceTimersByTimeAsync(4000);
    const second=journal.journalAuthority();const failedSecond=expect(second).rejects.toMatchObject({code:'unavailable'});
    await first;await vi.advanceTimersByTimeAsync(4000);
    const third=journal.journalAuthority();const failedThird=expect(third).rejects.toMatchObject({code:'unavailable'});
    await vi.advanceTimersByTimeAsync(1001);await Promise.all([failedSecond,failedThird]);
    expect(sink).toHaveBeenCalledOnce();await expect(journal.journalAuthority()).rejects.toMatchObject({code:'unavailable'});
    await expect(journal.close()).rejects.toMatchObject({code:'unavailable'});
  } finally {sink.mockRestore();vi.useRealTimers();await journal?.abort();}
});
it('projects unknown worker failure codes without logging submitted data',async()=>{
 const entry=join(dirname(fileURLToPath(fixture.workerUrl())),'bad-code.mjs');
 await writeFile(entry,`import {parentPort} from 'node:worker_threads';parentPort.postMessage({kind:'startup_error',code:'CANARY-secret-sql-path'});`);
 const sink=vi.spyOn(process.stderr,'write').mockImplementation(()=>true);
 try {
  await expect(openJournal({path:fixture.path(),workerUrl:pathToFileURL(entry)})).rejects.toMatchObject({code:'unavailable',message:'Journal unavailable'});
  expect(sink).toHaveBeenCalledOnce();expect(String(sink.mock.calls[0]?.[0])).not.toContain('CANARY');
  expect(JSON.parse(String(sink.mock.calls[0]?.[0]))).toMatchObject({component:'journal',code:'unavailable',pending:0});
 } finally {sink.mockRestore();}
});

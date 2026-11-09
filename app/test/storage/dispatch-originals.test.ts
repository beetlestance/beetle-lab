import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import type { Worker } from 'node:worker_threads';
import { openMetadata } from '../../src/adapters/outbound/sqlite/index.js';
import type { Metadata } from '../../src/adapters/outbound/sqlite/index.js';
import { initialize } from '../../src/adapters/outbound/sqlite/schema.js';
import { seedFoundation, enqueue } from './execution-foundation-fixtures.js';
import { observation, settingsFixture, scope, uuid } from './fixture.js';

let root: string; let sequence = 0;
const handles = new Set<Metadata>();
const fixtureWorker = `
import { parentPort, workerData } from 'node:worker_threads';
import { existsSync, readFileSync } from 'node:fs';
const held = [];
const values = JSON.parse(readFileSync(workerData.path + '.reply.json', 'utf8'));
function reply(message) {
  if (message.kind === 'close') {
    parentPort.postMessage({kind:'result',messageId:message.messageId,ok:true,value:null});
    clearInterval(timer); parentPort.close(); return;
  }
  let value = message.kind === 'dispatchReadOffer' ? {key:message.key,offer:values.offer} : values.suite;
  if (values.mode === 'wrong-key' && message.kind === 'dispatchReadOffer') value.key = {...message.key,runId:message.key.attempt.attemptId};
  parentPort.postMessage({kind:'result',messageId:message.messageId,ok:values.mode === 'bad-control' ? 'yes' : true,value});
}
parentPort.on('message', message => held.push(message));
const timer = setInterval(() => {
  if (existsSync(workerData.path + '.release')) while (held.length) reply(held.shift());
}, 5);
parentPort.postMessage({kind:'ready'});
`;
beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'beetle-dispatch-originals-'));
  await writeFile(join(root, 'worker.mjs'), fixtureWorker);
});
afterEach(async () => { await Promise.all([...handles].map(handle => handle.abort())); handles.clear(); vi.restoreAllMocks(); });
afterAll(async () => { await rm(root, { recursive: true, force: true }); });
async function open(mode = 'valid') {
  const path = join(root, `metadata-${++sequence}.sqlite`);
  const db = initialize(':memory:');
  let original: ReturnType<typeof enqueue>;
  try {
    const store = seedFoundation(db); original = enqueue(db, store);
    const suite = store.execute({ kind: 'getSuite', key: { scope, id: uuid(50) } });
    await writeFile(path + '.reply.json', JSON.stringify({ offer: original.offer, suite, mode }));
  } finally { db.close(); }
  const values = settingsFixture();
  const metadata = await openMetadata({ path, workerUrl: pathToFileURL(join(root, 'worker.mjs')),
    installation: values.chain.installation, runtime: observation(values.runtime) });
  handles.add(metadata);
  return { metadata, original, release: () => writeFile(path + '.release', '') };
}

it.each(['offer', 'suite'] as const)('shares TWO original credits when %s calls hold the worker', async kind => {
  const { metadata, original, release } = await open();
  const issue = () => kind === 'offer' ? metadata.dispatch.readOffer(original.key)
    : metadata.suites.getSuite({ scope, id: uuid(50) });
  const first = issue(); const second = issue();
  const third = kind === 'offer' ? metadata.suites.getSuite({ scope, id: uuid(50) })
    : metadata.dispatch.readOffer(original.key);
  await expect(third).rejects.toMatchObject({ code: 'queue_full' });
  let closed = false; const closing = metadata.close().then(() => { closed = true; });
  await expect(metadata.dispatch.readOffer(original.key)).rejects.toMatchObject({ code: 'closed' });
  await new Promise<void>(resolve => setImmediate(resolve)); expect(closed).toBe(false);
  await release();
  const values = await Promise.all([first, second]);
  if (kind === 'offer') expect(values).toEqual([{ key: original.key, offer: original.offer }, { key: original.key, offer: original.offer }]);
  await closing; expect(closed).toBe(true);
});

it('rejects before original capture when the shared allowance is full', async () => {
  const { metadata, original, release } = await open();
  const first = metadata.dispatch.readOffer(original.key); const second = metadata.dispatch.readOffer(original.key);
  const getter = vi.fn(() => original.key.runId);
  const key = Object.defineProperty({ ...original.key }, 'runId', { enumerable: true, get: getter });
  await expect(metadata.dispatch.readOffer(key)).rejects.toMatchObject({ code: 'queue_full' });
  expect(getter).not.toHaveBeenCalled();
  await release(); await Promise.all([first, second]);
});

it.each(['wrong-key', 'bad-control'])('fences malformed %s replies without publishing values', async mode => {
  const { metadata, original, release } = await open(mode);
  const first = metadata.dispatch.readOffer(original.key); const rejection = expect(first).rejects.toMatchObject({ code: 'unavailable' });
  await release(); await rejection;
  await expect(metadata.dispatch.readOffer(original.key)).rejects.toMatchObject({ code: 'unavailable' });
  await metadata.abort();
});

it('fences exhausted wire identity before issuing or overwriting an original', async () => {
  const { metadata, original } = await open();
  const worker = Reflect.get(metadata, 'worker') as Worker;
  const issue = vi.spyOn(worker, 'postMessage');
  Reflect.set(metadata, 'nextId', Number.MAX_SAFE_INTEGER);
  await expect(metadata.dispatch.readOffer(original.key)).rejects.toMatchObject({ code: 'unavailable' });
  expect(issue).not.toHaveBeenCalled();
  await metadata.abort();
});

it('retains the same original termination through abort and close while replies remain held', async () => {
  const { metadata, original } = await open();
  const worker = Reflect.get(metadata, 'worker') as Worker;
  const nativeTerminate = worker.terminate.bind(worker);
  let finish!: (code: number) => void;
  const termination = new Promise<number>(resolve => { finish = resolve; });
  const terminate = vi.spyOn(worker, 'terminate').mockReturnValue(termination);
  const first = metadata.dispatch.readOffer(original.key);
  const second = metadata.dispatch.readOffer(original.key);
  const rejected = Promise.all([expect(first).rejects.toMatchObject({ code: 'unavailable' }),
    expect(second).rejects.toMatchObject({ code: 'unavailable' })]);
  let aborted = false; const aborting = metadata.abort().then(() => { aborted = true; });
  const closing = metadata.close(); const closeRejected = expect(closing).rejects.toMatchObject({ code: 'unavailable' });
  try {
    await rejected; await new Promise<void>(resolve => setImmediate(resolve));
    expect(aborted).toBe(false); expect(terminate).toHaveBeenCalledTimes(1);
    await expect(metadata.dispatch.readOffer(original.key)).rejects.toMatchObject({ code: 'closed' });
  } finally {
    finish(await nativeTerminate());
    await aborting; await closeRejected;
  }
  expect(aborted).toBe(true); expect(terminate).toHaveBeenCalledTimes(1);
});

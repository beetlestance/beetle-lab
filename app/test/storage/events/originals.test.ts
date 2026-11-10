import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { openMetadata } from '../../../src/adapters/outbound/sqlite/index.js';
import type { Metadata } from '../../../src/adapters/outbound/sqlite/index.js';
import { observation, settingsFixture, scope, uuid } from '../fixture.js';
import { eventFixture, request } from './fixtures.js';
let root: string; let seq = 0;
const handles = new Set<Metadata>();
const code = `
import {parentPort,workerData} from 'node:worker_threads';
import {existsSync,readFileSync} from 'node:fs';
const values=JSON.parse(readFileSync(workerData.path+'.json','utf8'));
const held=[];
parentPort.on('message',message=>held.push(message));
const timer=setInterval(()=>{
 if(!existsSync(workerData.path+'.release'))return;
 while(held.length){
  const message=held.shift();
  if(message.kind==='close'){
   parentPort.postMessage({kind:'result',messageId:message.messageId,ok:true,value:null});
   clearInterval(timer);parentPort.close();return;
  }
  let value=message.kind==='eventIngest'?values.result:values.suite;
  if(values.mode==='wrong-state')value.state.binding.journalAuthority='44444444-4444-4444-8444-444444444444';
  if(values.mode==='bad-ack')value.ackThrough=1;
  parentPort.postMessage({kind:'result',messageId:message.messageId,ok:true,value});
 }
},5);
parentPort.postMessage({kind:'ready'});
`;
beforeAll(async () => { root = await mkdtemp(join(tmpdir(), 'beetle-event-originals-')); await writeFile(join(root, 'worker.mjs'), code); });
afterEach(async () => { await Promise.all([...handles].map(handle => handle.abort())); handles.clear(); });
afterAll(async () => { await rm(root, { recursive: true, force: true }); });
async function open(mode = 'valid') {
  const f = eventFixture(); const path = join(root, `metadata-${++seq}.sqlite`);
  const state = f.store.execute({ kind: 'eventLoad', binding: f.binding });
  const suite = f.store.execute({ kind: 'getSuite', key: { scope, id: uuid(50) } });
  await writeFile(path + '.json', JSON.stringify({ mode, result: { state, inserted: 0, ackThrough: 0 }, suite }));
  const values = settingsFixture();
  const metadata = await openMetadata({ path, workerUrl: pathToFileURL(join(root, 'worker.mjs')),
    installation: values.chain.installation, runtime: observation(values.runtime) });
  handles.add(metadata); return { metadata, binding: f.binding, release: () => writeFile(path + '.release', '') };
}
it.each(['event', 'suite'] as const)('shares exactly TWO original credits across %s and event calls before traversing an unknown body', async kind => {
  const { metadata, binding, release } = await open();
  const issue = () => kind === 'event' ? metadata.events.ingest(request(binding, 0, 0)) : metadata.suites.getSuite({ scope, id: uuid(50) });
  const first = issue(); const second = issue(); const getter = vi.fn();
  const body = Object.defineProperty(request(binding), 'batch', { enumerable: true, get: getter });
  await expect(metadata.events.ingest(body)).rejects.toMatchObject({ code: 'queue_full' });
  expect(getter).not.toHaveBeenCalled();
  await expect(metadata.dispatch.readOffer(binding.key)).rejects.toMatchObject({ code: 'queue_full' });
  let closed = false; const closing = metadata.close().then(() => { closed = true; });
  await expect(metadata.events.load(binding)).rejects.toMatchObject({ code: 'closed' });
  await new Promise<void>(resolve => setImmediate(resolve)); expect(closed).toBe(false);
  await release(); await Promise.all([first, second]); await closing; expect(closed).toBe(true);
});
it.each(['wrong-state', 'bad-ack'])('fences malformed %s producer replies and retains worker failure', async mode => {
  const { metadata, binding, release } = await open(mode);
  const issued = metadata.events.ingest(request(binding, 0, 0));
  const rejected = expect(issued).rejects.toMatchObject({ code: 'unavailable' });
  await release(); await rejected;
  await expect(metadata.events.load(binding)).rejects.toMatchObject({ code: 'unavailable' });
});

import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest';
import { Worker } from 'node:worker_threads';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { configDigest, openJournal } from '../../src/journal/index.js';
import type { Journal } from '../../src/journal/index.js';
import { journalFixture } from './fixtures.js';

const f = journalFixture();
let root: string; let workerUrl: URL;
const handles: Journal[] = [];
beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'beetle-journal-large-'));
  const entry = join(root, 'held.mjs');
  await writeFile(entry, `import {parentPort} from 'node:worker_threads';
    const held=[]; let posted=0;
    parentPort.on('message',command=>{
      posted++;
      if(command.kind==='offer'||command.kind==='read'||command.kind==='admission'&&command.request.kind==='offer') { held.push(command); return; }
      if(command.kind==='close') {
        for(const original of held) parentPort.postMessage({kind:'result',id:original.id,ok:true,value:null});
      }
      const value=command.kind==='get'?{large:held.map(original=>original.kind),posted}:null;
      parentPort.postMessage({kind:'result',id:command.id,ok:true,value});
      if(command.kind==='close') parentPort.close();
    }); parentPort.postMessage({kind:'ready'});`);
  workerUrl = pathToFileURL(entry);
});
afterEach(async () => { await Promise.all(handles.splice(0).map(journal => journal.abort())); });
afterAll(async () => { await rm(root, { recursive: true, force: true }); });
async function open(queueLimit = 64): Promise<Journal> {
  const journal = await openJournal({ path: join(root, 'unused.sqlite'), workerUrl, queueLimit }); handles.push(journal); return journal;
}
function fullOffer() {
  const offer = f.offer(); offer.config = { value: '' };
  offer.config.value = 'x'.repeat(1048576 - Buffer.byteLength(JSON.stringify(offer.config))); return offer;
}
function offerCommand() {
  const offer = fullOffer();
  return { kind: 'offer' as const, offer, now: 1, validation: {
    manifestId: 'synthetic', profileId: 'synthetic', schemaDigest: 'b'.repeat(64),
    catalogVersion: 1, configDigest: configDigest(offer.config) } };
}
it.each(['held', 'snapshot'])('accounts actual validated Offer after changing hint with %s capacity fill', async mode => {
  const journal = await open(); const first = journal.immutableOffer(fullOffer());
  let second = mode === 'held' ? journal.readOffer(f.key()) : undefined;
  let descriptors = 0; let traversal = 0;
  const input = new Proxy(offerCommand(), {
    getOwnPropertyDescriptor(target, key) {
      const descriptor = Reflect.getOwnPropertyDescriptor(target, key);
      if (key === 'kind' && ++descriptors === 1) return { ...descriptor, value: 'configure' };
      return descriptor;
    },
    ownKeys(target) {
      traversal++; second ??= journal.readOffer(f.key()); return Reflect.ownKeys(target);
    },
  });
  await expect(journal.admission(input)).rejects.toMatchObject({ code: 'queue_full' });
  expect(descriptors).toBeGreaterThan(1); expect(traversal).toBeGreaterThan(0);
  await expect(journal.get(f.key())).resolves.toEqual({ large: ['offer', 'read'], posted: 3 });
  await Promise.all([first, second, journal.close()]);
});
it('rechecks total capacity after snapshot reentrancy and still posts the reserved close', async () => {
  const journal = await open(1); const posted = vi.spyOn(Worker.prototype, 'postMessage');
  let nested: Promise<unknown> | undefined; let traversed = false;
  const input = new Proxy(f.key(), { ownKeys(target) {
    traversed = true; nested ??= journal.readOffer(f.key()); return Reflect.ownKeys(target);
  } });
  try {
    await expect(journal.get(input)).rejects.toMatchObject({ code: 'queue_full' }); expect(traversed).toBe(true);
    expect(posted.mock.calls.map(([command]) => (command as { kind: string }).kind)).toEqual(['read']);
    await Promise.all([nested, journal.close()]);
    expect(posted.mock.calls.map(([command]) => (command as { kind: string }).kind)).toEqual(['read', 'close']);
  } finally { posted.mockRestore(); }
});
it('accounts a validated control operation independently of a conservative large hint', async () => {
  const journal = await open(); const first = journal.immutableOffer(fullOffer()); let descriptors = 0;
  const input = new Proxy({ kind: 'reservations' as const, limit: 1 }, {
    getOwnPropertyDescriptor(target, key) {
      const descriptor = Reflect.getOwnPropertyDescriptor(target, key);
      if (key === 'kind' && ++descriptors === 1) return { ...descriptor, value: 'offer' };
      return descriptor;
    },
  });
  const control = journal.admission(input); const second = journal.readOffer(f.key());
  await expect(journal.get(f.key())).resolves.toEqual({ large: ['offer', 'read'], posted: 4 });
  await Promise.all([first, control, second, journal.close()]);
});
it('rechecks the close fence after snapshot reentrancy', async () => {
  const journal = await open(); const posted = vi.spyOn(Worker.prototype, 'postMessage');
  let closing: Promise<void> | undefined;
  const input = new Proxy(f.key(), { ownKeys(target) {
    closing ??= journal.close(); return Reflect.ownKeys(target);
  } });
  try {
    await expect(journal.get(input)).rejects.toMatchObject({ code: 'closed' }); await closing;
    expect(posted.mock.calls.map(([command]) => (command as { kind: string }).kind)).toEqual(['close']);
  } finally { posted.mockRestore(); }
});
it.each(['offer', 'read', 'admission'])('reserves only two original large operations across %s and leaves control/close capacity', async kind => {
  const journal = await open(); const first = journal.immutableOffer(fullOffer());
  const second = journal.readOffer(f.key()); let observed = false;
  const opaque = new Proxy({}, { ownKeys() { observed = true; throw new Error('traversed'); } });
  const command = new Proxy({ kind: 'offer' }, {
    ownKeys() { observed = true; throw new Error('traversed'); },
    getOwnPropertyDescriptor(target, key) { if (key !== 'kind') observed = true; return Reflect.getOwnPropertyDescriptor(target, key); },
  });
  const third = kind === 'offer' ? journal.immutableOffer(opaque)
    : kind === 'read' ? journal.readOffer(opaque as never) : journal.admission(command as never);
  await expect(third).rejects.toMatchObject({ code: 'queue_full' }); expect(observed).toBe(false);
  await expect(journal.get(f.key())).resolves.toEqual({ large: ['offer', 'read'], posted: 3 });
  let settled = false; void first.then(() => { settled = true; });
  await new Promise<void>(resolve => setImmediate(resolve)); expect(settled).toBe(false);
  const closing = journal.close(); await Promise.all([first, second, closing]);
  await expect(journal.readOffer(f.key())).rejects.toMatchObject({ code: 'closed' });
});
it.each([32, 64])('retains two large originals inside total capacity%s and reserves close at saturation', async limit => {
  const journal = await open(limit); const first = journal.immutableOffer(f.offer()); const second = journal.readOffer(f.key());
  const controls = Array.from({ length: limit - 2 }, () => journal.get(f.key()));
  let observed = false;
  const key = new Proxy({}, {
    ownKeys() { observed = true; throw new Error('traversed'); },
    getOwnPropertyDescriptor() { observed = true; throw new Error('observed'); },
  });
  await expect(journal.get(key as never)).rejects.toMatchObject({ code: 'queue_full' }); expect(observed).toBe(false);
  await Promise.all([first, second, ...controls, journal.close()]);
});
it('retains original failures through abort without creating replacement capacity', async () => {
  const journal = await open();
  const first = journal.immutableOffer(f.offer()); const second = journal.readOffer(f.key());
  const rejected = Promise.all([expect(first).rejects.toMatchObject({ code: 'unavailable' }),
    expect(second).rejects.toMatchObject({ code: 'unavailable' })]);
  await journal.abort(); await rejected;
  await expect(journal.immutableOffer(f.offer())).rejects.toMatchObject({ code: 'closed' });
});
it('refunds a reserved large slot on validation failure', async () => {
  const journal = await open();
  for (let index = 0; index < 3; index++) {
    await expect(journal.immutableOffer({})).rejects.toMatchObject({ code: 'invalid_input' });
  }
  const first = journal.immutableOffer(fullOffer()); const second = journal.readOffer(f.key());
  await expect(journal.readOffer(f.key())).rejects.toMatchObject({ code: 'queue_full' });
  await Promise.all([first, second, journal.close()]);
});

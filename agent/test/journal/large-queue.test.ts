import { afterAll, afterEach, beforeAll, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { openJournal } from '../../src/journal/index.js';
import type { Journal } from '../../src/journal/index.js';
import { journalFixture } from './fixtures.js';

const f = journalFixture();
let root: string; let workerUrl: URL;
const handles: Journal[] = [];
beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'beetle-journal-large-'));
  const entry = join(root, 'held.mjs');
  await writeFile(entry, `import {parentPort} from 'node:worker_threads';
    const held=[];
    parentPort.on('message',command=>{
      if(command.kind==='offer'||command.kind==='read'||command.kind==='admission'&&command.request.kind==='offer') { held.push(command); return; }
      if(command.kind==='close') {
        for(const original of held) parentPort.postMessage({kind:'result',id:original.id,ok:true,value:null});
      }
      parentPort.postMessage({kind:'result',id:command.id,ok:true,value:null});
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
it.each(['offer', 'read', 'admission'])('reserves only two original large operations across %s and leaves control/close capacity', async kind => {
  const journal = await open(); const first = journal.immutableOffer(fullOffer());
  const second = journal.readOffer(f.key()); let observed = false;
  const accessor = Object.defineProperty({}, 'config', { enumerable: true, get() { observed = true; return null; } });
  const third = kind === 'offer' ? journal.immutableOffer(accessor)
    : kind === 'read' ? journal.readOffer(accessor as never)
      : journal.admission({ kind: 'offer', get offer() { observed = true; return f.offer(); } } as never);
  await expect(third).rejects.toMatchObject({ code: 'queue_full' }); expect(observed).toBe(false);
  await expect(journal.get(f.key())).resolves.toBeNull();
  let settled = false; void first.then(() => { settled = true; });
  await new Promise<void>(resolve => setImmediate(resolve)); expect(settled).toBe(false);
  const closing = journal.close(); await Promise.all([first, second, closing]);
  await expect(journal.readOffer(f.key())).rejects.toMatchObject({ code: 'closed' });
});
it.each([32, 64])('retains two large originals inside total capacity%s and reserves close at saturation', async limit => {
  const journal = await open(limit); const first = journal.immutableOffer(f.offer()); const second = journal.readOffer(f.key());
  const controls = Array.from({ length: limit - 2 }, () => journal.get(f.key()));
  let observed = false;
  const key = Object.defineProperty({}, 'attemptId', { enumerable: true, get() { observed = true; return ''; } });
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

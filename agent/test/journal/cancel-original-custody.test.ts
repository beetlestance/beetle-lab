import { writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { expect, it } from 'vitest';
import { openJournal } from '../../src/journal/index.js';
import { captureCancelledOriginal } from '../../src/journal/cancel-original-input.js';
import { offerInput } from '../../src/journal/input.js';
import { fullOffer } from '../integration/offer-envelope-fixtures.js';
import { original, shape } from './admission-offer-fixtures.js';
import { journalFixture } from './fixtures.js';

const f = journalFixture();

it.each(['nodes', 'depth'] as const)('captures and journals an exact maximum-%s original independently of its carrier', async boundary => {
  const journal = await f.open(); const offer = original(boundary);
  expect(shape(offer)[boundary]).toBe(boundary === 'nodes' ? 65_536 : 64);
  const input = { offer, now: 1000 }; const captured = captureCancelledOriginal(input);
  const result = journal.cancelOriginal(input);
  input.now = 2000; offer.config = { changed: true };
  expect((await result).admission).toEqual({ state: 'rejected', reason: 'cancelled' });
  const key = { attemptId: offer.attemptId, organizationId: offer.organizationId, workspaceId: offer.workspaceId };
  expect(JSON.stringify(await journal.readOffer(key))).toBe(captured.json);
  expect(await journal.supervision({ key: { ...key, generation: 1 }, now: 3000 })).toMatchObject({ cancelRequestedAt: 1000 });
});

it.each(['nodes', 'depth'] as const)('rejects original %s plus one before worker writes', async boundary => {
  const journal = await f.open();
  await expect(journal.cancelOriginal({ offer: original(boundary, boundary === 'nodes' ? 65_537 : 65), now: 1000 }))
    .rejects.toMatchObject({ code: 'invalid_input' });
  expect(await journal.listOpen({ limit: 1 })).toEqual({ snapshots: [] });
});

it('preserves the 2 MiB Offer carrier limit and rejects overflow without effects', async () => {
  const journal = await f.open(); const offer = fullOffer(f.offer());
  const bytes = Buffer.byteLength(offerInput(offer).json);
  expect(bytes).toBeGreaterThan(1_048_576); expect(bytes).toBeLessThanOrEqual(2_097_152);
  expect((await journal.cancelOriginal({ offer, now: 1000 })).admission).toEqual({ state: 'rejected', reason: 'cancelled' });
  await expect(journal.cancelOriginal({ offer: { ...offer, config: { value: 'x'.repeat(2_097_152) } }, now: 1000 }))
    .rejects.toMatchObject({ code: 'invalid_input' });
});

it.each([-1, 0.5, NaN, Infinity, 8_640_000_000_000_001])('rejects trusted time %s without accepting a receipt', async now => {
  const journal = await f.open();
  await expect(journal.cancelOriginal({ offer: f.offer(), now })).rejects.toMatchObject({ code: 'invalid_input' });
  expect(await journal.listOpen({ limit: 1 })).toEqual({ snapshots: [] });
});

it.each(['offer', 'now'] as const)('rejects the %s carrier accessor without invoking it', async field => {
  const journal = await f.open(); let invoked = 0; const input = { offer: f.offer(), now: 1000 };
  Object.defineProperty(input, field, { enumerable: true, get() { invoked++; throw new Error('synthetic'); } });
  await expect(journal.cancelOriginal(input)).rejects.toMatchObject({ code: 'invalid_input' });
  expect(invoked).toBe(0);
});

it('shares two original credits with PUT/read and retains FIFO writes through close', async () => {
  const path = f.path(); const entry = path + '.mjs';
  await writeFile(entry, `import {parentPort} from 'node:worker_threads';
    const delay = new Int32Array(new SharedArrayBuffer(4));
    parentPort.on('message',command=>{if(command.kind==='cancelOriginal') Atomics.wait(delay,0,0,100);});
    await import(${JSON.stringify(f.workerUrl().href)});`);
  const journal = await openJournal({ path, workerUrl: pathToFileURL(entry) });
  try {
    const offer = f.offer(); const other = { ...offer, attemptId: '00000000-0000-4000-8000-000000000099' };
    const cancel = journal.cancelOriginal({ offer, now: 1000 });
    const put = journal.immutableOffer(other);
    const denied = expect(journal.readOffer(f.key())).rejects.toMatchObject({ code: 'queue_full' });
    const closing = journal.close();
    await denied;
    expect((await cancel).admission).toEqual({ state: 'rejected', reason: 'cancelled' });
    expect((await put).cancelRequested).toBe(false);
    await closing;
    await expect(journal.cancelOriginal({ offer, now: 2000 })).rejects.toMatchObject({ code: 'closed' });
  } finally { await journal.abort(); }
  const reopened = await f.open(path);
  expect((await reopened.get(f.key())).admission).toEqual({ state: 'rejected', reason: 'cancelled' });
});

it('treats worker crash as unavailable with unknown receipt outcome, never a fabricated refusal', async () => {
  const path = f.path(); const entry = path + '.mjs';
  await writeFile(entry, `import {parentPort} from 'node:worker_threads';
    parentPort.on('message',command=>{if(command.kind==='cancelOriginal') process.exit(17);});
    await import(${JSON.stringify(f.workerUrl().href)});`);
  const journal = await openJournal({ path, workerUrl: pathToFileURL(entry) });
  try { await expect(journal.cancelOriginal({ offer: f.offer(), now: 1000 })).rejects.toMatchObject({ code: 'unavailable' }); }
  finally { await journal.abort(); }
  const reopened = await f.open(path);
  await expect(reopened.get(f.key())).rejects.toMatchObject({ code: 'not_found' });
});

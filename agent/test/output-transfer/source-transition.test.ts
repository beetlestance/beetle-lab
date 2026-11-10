import { expect, it, vi } from 'vitest';
import type { OutputDeliveryClosure } from '../../src/journal/index.js';
import { JournalError } from '../../src/journal/index.js';
import { deliveryFixture } from '../output-delivery/fixtures.js';
import { now, scope } from '../admission/fixtures.js';
import { operation, ranges, reader, track } from './fixtures.js';

const f = deliveryFixture();
type Seed = Awaited<ReturnType<typeof f.seed>>;
/** Hold an actual null observation while a real producer commits/release/closure. */
function transition(e: Seed, closed: boolean, afterReread?: () => void) {
  const source = e.journal.readOutputSource.bind(e.journal); const snapshot = e.journal.get.bind(e.journal);
  const order: string[] = []; let closure: OutputDeliveryClosure | null = null;
  const get = vi.spyOn(e.journal, 'get').mockImplementation(async key => {
    const value = await snapshot(key); expect(value.admission?.state).toBe('released'); order.push('released snapshot'); return value;
  });
  const read = vi.spyOn(e.journal, 'readOutputSource').mockImplementationOnce(async key => {
    const absent = await source(key); expect(absent).toBeNull(); order.push('old absence');
    await e.journal.beginOutputCollection(e.intent); const receipt = await e.journal.commitOutputSource(e.collected);
    expect(await e.journal.releaseOutputSource(receipt)).toMatchObject({ status: 'released' }); order.push('actual source/release');
    if (closed) closure = await e.journal.closeOutputDelivery(receipt);
    return absent;
  }).mockImplementationOnce(async key => {
    order.push('source after terminal'); const value = await source(key); afterReread?.(); return value;
  });
  return { read, get, order, closure: () => closure };
}

it('returns a verified closed source committed between old absence and newer released snapshot', async () => {
  const e = await f.seed(); const boundary = transition(e, true); const r = reader(e.journal);
  const value = await track(r.service.source(e.key, operation()));
  expect(value).toEqual({ version: 1, manifest: e.source.manifest, sourceDigest: e.source.sourceDigest, closure: boundary.closure() });
  expect(boundary.read).toHaveBeenCalledTimes(2); expect(boundary.get).toHaveBeenCalledTimes(1);
  expect(boundary.order).toEqual(['old absence', 'actual source/release', 'released snapshot', 'source after terminal']);
  expect(r.readRange).not.toHaveBeenCalled();
});

it('returns pending for real source/release debt committed between absence and terminal snapshot without closure', async () => {
  const e = await f.seed(); const boundary = transition(e, false); const r = reader(e.journal);
  await expect(track(r.service.source(e.key, operation()))).rejects.toMatchObject({ code: 'pending' });
  expect(boundary.read).toHaveBeenCalledTimes(2); expect(boundary.get).toHaveBeenCalledTimes(1);
  expect(boundary.order).toEqual(['old absence', 'actual source/release', 'released snapshot', 'source after terminal']);
  expect(await e.journal.readOutputDelivery(e.key)).toBeNull(); expect(r.readRange).not.toHaveBeenCalled();
});

async function sourceFree(state: 'released' | 'rejected') {
  if (state === 'released') {
    const e = await f.seed(); await e.journal.beginOutputCollection(e.intent); await e.journal.failOutputCollection(e.failed);
    return { journal: e.journal, key: e.key };
  }
  const journal = await f.configured(); const offer = f.job(); await journal.cancelOriginal({ offer, now });
  return { journal, key: scope(offer) };
}

it.each(['released', 'rejected'] as const)('requires actual post-%s source absence before unavailable', async state => {
  const { journal, key } = await sourceFree(state); const source = journal.readOutputSource.bind(journal); const snapshot = journal.get.bind(journal);
  const order: string[] = [];
  const read = vi.spyOn(journal, 'readOutputSource').mockImplementation(async key => {
    const value = await source(key); expect(value).toBeNull(); order.push('absence'); return value;
  });
  const get = vi.spyOn(journal, 'get').mockImplementation(async key => {
    const value = await snapshot(key); expect(value.admission?.state).toBe(state); order.push('terminal'); return value;
  });
  const closure = vi.spyOn(journal, 'readOutputDelivery'); const r = reader(journal);
  await expect(track(r.service.source(key, operation()))).rejects.toMatchObject({ code: 'unavailable' });
  expect(order).toEqual(['absence', 'terminal', 'absence']); expect(read).toHaveBeenCalledTimes(2); expect(get).toHaveBeenCalledTimes(1);
  expect(closure).not.toHaveBeenCalled(); expect(r.readRange).not.toHaveBeenCalled();
});

it('keeps the existing-source hot path at one source lookup without a snapshot query', async () => {
  const e = await f.ready(); const closure = await e.journal.closeOutputDelivery(e.receipt);
  const read = vi.spyOn(e.journal, 'readOutputSource'); const get = vi.spyOn(e.journal, 'get'); const delivery = vi.spyOn(e.journal, 'readOutputDelivery');
  const r = reader(e.journal);
  expect(await track(r.service.source(e.key, operation()))).toEqual({ version: 1, manifest: e.source.manifest, sourceDigest: e.source.sourceDigest, closure });
  expect(read).toHaveBeenCalledTimes(1); expect(get).not.toHaveBeenCalled(); expect(delivery).toHaveBeenCalledTimes(1); expect(r.readRange).not.toHaveBeenCalled();
});

it('keeps a known unfinished source absence pending without a second source lookup', async () => {
  const e = await f.seed(); const read = vi.spyOn(e.journal, 'readOutputSource'); const get = vi.spyOn(e.journal, 'get');
  const delivery = vi.spyOn(e.journal, 'readOutputDelivery'); const r = reader(e.journal);
  await expect(track(r.service.source(e.key, operation()))).rejects.toMatchObject({ code: 'pending' });
  expect(read).toHaveBeenCalledTimes(1); expect(get).toHaveBeenCalledTimes(1); expect(delivery).not.toHaveBeenCalled(); expect(r.readRange).not.toHaveBeenCalled();
});

it('rejects a mismatched snapshot scope before considering its terminal fact', async () => {
  const e = await sourceFree('released'); const snapshot = e.journal.get.bind(e.journal);
  vi.spyOn(e.journal, 'get').mockImplementation(async key => ({ ...await snapshot(key), workspaceId: 'ffffffff-ffff-4fff-8fff-ffffffffffff' }));
  const read = vi.spyOn(e.journal, 'readOutputSource'); const delivery = vi.spyOn(e.journal, 'readOutputDelivery'); const r = reader(e.journal);
  await expect(track(r.service.source(e.key, operation()))).rejects.toMatchObject({ code: 'unavailable' });
  expect(read).toHaveBeenCalledTimes(1); expect(delivery).not.toHaveBeenCalled(); expect(r.readRange).not.toHaveBeenCalled();
});

it.each(['abort', 'deadline'] as const)('checks %s after the terminal snapshot before issuing the bounded reread', async stop => {
  const e = await sourceFree('released'); const snapshot = e.journal.get.bind(e.journal); const abort = new AbortController(); let clock = 100;
  vi.spyOn(e.journal, 'get').mockImplementation(async key => {
    const value = await snapshot(key); if (stop === 'abort') abort.abort(); else clock = 1000; return value;
  });
  const read = vi.spyOn(e.journal, 'readOutputSource'); const delivery = vi.spyOn(e.journal, 'readOutputDelivery');
  const r = reader(e.journal, ranges(), () => clock);
  await expect(track(r.service.source(e.key, { ...operation(), signal: abort.signal }))).rejects.toMatchObject({ code: 'interrupted' });
  expect(read).toHaveBeenCalledTimes(1); expect(delivery).not.toHaveBeenCalled(); expect(r.readRange).not.toHaveBeenCalled();
});

it.each(['abort', 'deadline'] as const)('checks %s after the bounded reread before proving or reading closure', async stop => {
  const e = await f.seed(); const abort = new AbortController(); let clock = 100;
  const boundary = transition(e, true, () => { if (stop === 'abort') abort.abort(); else clock = 1000; });
  const delivery = vi.spyOn(e.journal, 'readOutputDelivery'); const r = reader(e.journal, ranges(), () => clock);
  await expect(track(r.service.source(e.key, { ...operation(), signal: abort.signal }))).rejects.toMatchObject({ code: 'interrupted' });
  expect(boundary.read).toHaveBeenCalledTimes(2); expect(boundary.get).toHaveBeenCalledTimes(1);
  expect(delivery).not.toHaveBeenCalled(); expect(r.readRange).not.toHaveBeenCalled();
});

it('preserves a Journal rejection from the bounded reread without inventing unavailable', async () => {
  const e = await f.seed(); const error = new JournalError('queue_full'); const boundary = transition(e, true, () => { throw error; });
  const delivery = vi.spyOn(e.journal, 'readOutputDelivery'); const r = reader(e.journal);
  await expect(track(r.service.source(e.key, operation()))).rejects.toBe(error);
  expect(boundary.read).toHaveBeenCalledTimes(2); expect(boundary.get).toHaveBeenCalledTimes(1);
  expect(delivery).not.toHaveBeenCalled(); expect(r.readRange).not.toHaveBeenCalled();
});

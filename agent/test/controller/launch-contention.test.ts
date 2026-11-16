import { expect, it, vi } from 'vitest';
import { JournalError } from '../../src/journal/index.js';
import { fixture, budget } from './fixtures.js';
import { creditHold } from './credit-hold.js';
import { reserved } from '../supervisor/fixtures.js';
import { deferred } from '../supervisor/fixtures.js';

const f = fixture();
for (const site of ['controller', 'actor'] as const) {
  it(`retains one original intent across repeated real Journal credit refusal at ${site} read`, async () => {
    const e = await f.setupController(); const hold = await creditHold(e.journal, e.offer);
    const read = e.journal.readOffer.bind(e.journal);
    const readSpy = vi.spyOn(e.journal, 'readOffer');
    if (site === 'actor') readSpy.mockImplementationOnce(async key => {
      const offer = await read(key); hold.start(); return offer;
    });
    else hold.start();
    const admission = vi.spyOn(e.journal, 'admission'); const supervision = vi.spyOn(e.journal, 'supervision');
    try {
      const original = reserved(await e.journal.admission({ kind: 'reservation', key: e.key }));
      expect(await e.controller.launch(budget())).toEqual({ kind: 'deferred', reason: 'journal_busy' });
      expect(await e.controller.tick(budget())).toEqual({ kind: 'deferred', reason: 'journal_busy' });
      expect(hold.held).toHaveLength(2);
      expect(hold.reads.filter(id => id === e.offer.attemptId)).toHaveLength(site === 'actor' ? 1 : 0);
      expect(admission.mock.calls.some(([c]) => c.kind === 'claimCreate' || c.kind === 'claimStart')).toBe(false);
      expect(supervision).not.toHaveBeenCalled(); expect(e.readers).toHaveLength(0); expect(e.collections).toHaveLength(0);
      expect(e.backend.creates).toBe(0); expect(e.backend.starts).toBe(0);
      expect(reserved(await e.journal.admission({ kind: 'reservation', key: e.key }))).toEqual(original);
      await hold.release();
      await e.controller.tick(budget()); await e.controller.tick(budget());
      expect(e.backend.creates).toBe(1); expect(e.backend.starts).toBe(1);
      const reads = readSpy.mock.calls.length;
      await e.controller.tick(budget()); await e.controller.tick(budget());
      expect(readSpy).toHaveBeenCalledTimes(reads);
    } finally { await hold.close(); readSpy.mockRestore(); admission.mockRestore(); supervision.mockRestore(); }
  });
}
it('tick-only owners never inherit an implicit explicit launch after refusal', async () => {
  const e = await f.setupController(); const read = vi.spyOn(e.journal, 'readOffer').mockRejectedValueOnce(new JournalError('queue_full'));
  expect(await e.controller.tick(budget())).toMatchObject({ kind: 'deferred' });
  read.mockRestore(); await e.controller.tick(budget());
  expect(e.backend.creates).toBe(0); expect(e.backend.starts).toBe(0);
});
for (const site of ['controller', 'actor'] as const) for (const fence of ['cancel', 'close', 'timeout', 'durable_cancel'] as const) {
  it(`${fence} prevents a launch deferred at ${site} from dispatching`, async () => {
    const e = await f.setupController(); const original = e.journal.readOffer.bind(e.journal);
    const read = vi.spyOn(e.journal, 'readOffer');
    if (site === 'actor') read.mockImplementationOnce(original);
    read.mockRejectedValueOnce(new JournalError('queue_full'));
    expect(await e.controller.launch(budget())).toMatchObject({ kind: 'deferred' }); read.mockRestore();
    if (fence === 'cancel') await e.controller.cancel();
    if (fence === 'close') await e.controller.close();
    if (fence === 'timeout') e.time.advance(1001);
    if (fence === 'durable_cancel') await e.journal.durableCancel(e.key);
    if (fence !== 'close') await e.controller.tick(budget());
    else await expect(e.controller.tick(budget())).rejects.toMatchObject({ reason: 'closed' });
    expect(e.backend.creates).toBe(0); expect(e.backend.starts).toBe(0);
  });
}
for (const site of ['controller', 'actor'] as const) it(`a completed ${site} deferral retires the old caller signal and deadline`, async () => {
  const e = await f.setupController(); const abort = new AbortController();
  const old = { deadline: performance.now() + 5000, signal: abort.signal };
  const original = e.journal.readOffer.bind(e.journal); const read = vi.spyOn(e.journal, 'readOffer');
  if (site === 'actor') read.mockImplementationOnce(original);
  read.mockRejectedValueOnce(new JournalError('queue_full'));
  expect(await e.controller.launch(old)).toMatchObject({ kind: 'deferred' }); read.mockRestore();
  abort.abort();
  const time = vi.spyOn(performance, 'now').mockReturnValue(old.deadline + 1);
  try { await e.controller.tick(budget()); expect(e.backend.starts).toBe(1); }
  finally { time.mockRestore(); }
});
for (const site of ['controller', 'actor'] as const) for (const fence of ['deadline', 'signal'] as const) {
  it(`an active ${fence} consumes intent even when the ${site} read refuses`, async () => {
    const e = await f.setupController(); const abort = new AbortController();
    const call = { deadline: performance.now() + 5000, signal: abort.signal };
    const original = e.journal.readOffer.bind(e.journal); const read = vi.spyOn(e.journal, 'readOffer');
    if (site === 'actor') read.mockImplementationOnce(original);
    read.mockImplementationOnce(async () => {
      if (fence === 'signal') abort.abort();
      else Object.defineProperty(performance, 'now', { configurable: true, value: () => call.deadline + 1 });
      throw new JournalError('queue_full');
    });
    const now = Object.getOwnPropertyDescriptor(performance, 'now');
    try { await expect(e.controller.launch(call)).rejects.toBeDefined(); }
    finally {
      if (now) Object.defineProperty(performance, 'now', now); else Reflect.deleteProperty(performance, 'now');
      read.mockRestore();
    }
    await e.controller.tick(budget()); expect(e.backend.creates).toBe(0);
  });
}
for (const site of ['controller', 'actor'] as const) it(`unavailable ${site} read consumes the explicit intent rather than reporting deferral`, async () => {
  const e = await f.setupController(); const original = e.journal.readOffer.bind(e.journal);
  const read = vi.spyOn(e.journal, 'readOffer');
  if (site === 'actor') read.mockImplementationOnce(original);
  read.mockRejectedValueOnce(new JournalError('unavailable'));
  await expect(e.controller.launch(budget())).rejects.toMatchObject({ reason: site === 'actor' ? 'supervisor' : 'journal' }); read.mockRestore();
  await e.controller.tick(budget()); expect(e.backend.starts).toBe(0);
});
it('post-read payload access cannot impersonate a nonissued read refusal', async () => {
  const e = await f.setupController(); const original = e.journal.readOffer.bind(e.journal);
  const read = vi.spyOn(e.journal, 'readOffer').mockImplementationOnce(async key => {
    const offer = await original(key);
    Object.defineProperty(offer, 'engine', { get() { throw new JournalError('queue_full'); } });
    return offer;
  });
  await expect(e.controller.launch(budget())).rejects.toMatchObject({ reason: 'journal' }); read.mockRestore();
  await e.controller.tick(budget()); expect(e.backend.creates).toBe(0);
});
it('a concurrently rejected launch cannot grant a tick-only owner intent', async () => {
  const e = await f.setupController(); const entered = deferred<void>(); const resume = deferred<void>();
  const read = vi.spyOn(e.journal, 'readOffer').mockImplementationOnce(async () => {
    entered.resolve(); await resume.promise; throw new JournalError('queue_full');
  });
  const tick = e.controller.tick(budget()); await entered.promise;
  await expect(e.controller.launch(budget())).rejects.toMatchObject({ reason: 'busy' });
  resume.resolve(); expect(await tick).toMatchObject({ kind: 'deferred' }); read.mockRestore();
  await e.controller.tick(budget()); expect(e.backend.creates).toBe(0); expect(e.backend.starts).toBe(0);
});

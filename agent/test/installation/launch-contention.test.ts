import { expect, it, vi } from 'vitest';
import { fixture, operation, scope } from './fixtures.js';
import { creditHold } from '../controller/credit-hold.js';
import { configuration, observation } from '../admission/fixtures.js';

const f = fixture();
for (const site of [3, 4]) {
  it(`keeps its staged plan/watch through real credit refusal at read ${site}`, async () => {
    const e = await f.setup(); const manager = e.create(); await e.accepted(manager);
    const hold = await creditHold(e.owner, e.offer);
    const original = e.owner.readOffer.bind(e.owner); let reads = 0;
    const read = vi.spyOn(e.owner, 'readOffer').mockImplementation(key => {
      if (key.attemptId === e.offer.attemptId && ++reads === site) hold.start();
      return original(key);
    });
    const prepare = vi.spyOn(e.stager, 'prepare'); const guard = vi.spyOn(e.options.guard, 'watch');
    const timeout = vi.spyOn(e.options.timeout, 'watch'); const providers = vi.spyOn(e.options, 'stagerFor');
    try {
      expect(await manager.drive(scope(e.offer), operation())).toEqual({ kind: 'deferred', reason: 'journal_busy' });
      expect(hold.held).toHaveLength(2); expect(prepare).toHaveBeenCalledTimes(1);
      expect(e.backend.creates).toBe(0); expect(e.backend.starts).toBe(0);
      expect((await manager.inspect(scope(e.offer))).allocation?.status).toBe('charged');
      expect(hold.reads.filter(id => id === e.offer.attemptId)).toHaveLength(site - 1);
      const providersBefore = providers.mock.calls.length;
      expect(await manager.drive(scope(e.offer), operation())).toEqual({ kind: 'deferred', reason: 'journal_busy' });
      expect(prepare).toHaveBeenCalledTimes(1); expect(providers).toHaveBeenCalledTimes(providersBefore);
      await hold.release();
      await manager.drive(scope(e.offer), operation());
      const captured = reads;
      await manager.drive(scope(e.offer), operation()); await manager.drive(scope(e.offer), operation());
      expect(reads).toBe(captured); expect(prepare).toHaveBeenCalledTimes(1);
      expect(providers).toHaveBeenCalledTimes(providersBefore);
      expect(guard).toHaveBeenCalledTimes(1); expect(timeout).toHaveBeenCalledTimes(1);
      expect(e.backend.creates).toBe(1); expect(e.backend.starts).toBe(1);
      await e.finish(manager);
    } finally { await hold.close(); read.mockRestore(); prepare.mockRestore(); guard.mockRestore(); timeout.mockRestore(); providers.mockRestore(); }
    await manager.close();
  });
}
it('permits three admitted synthetic engines and does not reread their configs on ordinary ticks', async () => {
  const e = await f.setup(); const config = configuration();
  config.maxTimeoutMs = e.offer.budget.timeoutMs;
  config.pool.stagingBytes = 100_000_000;
  const measured = observation(e.time.wall()); measured.freeDiskBytes = 200_000_000;
  await e.owner.admission({ kind: 'configure', configuration: config });
  await e.owner.admission({ kind: 'observe', observation: measured });
  const manager = e.create();
  const offers = [1, 2, 3].map(id => ({ ...structuredClone(e.offer), attemptId: f.job(id).attemptId }));
  const read = vi.spyOn(e.owner, 'readOffer');
  try {
    for (const offer of offers) {
      await e.accepted(manager, offer); await manager.drive(scope(offer), operation());
      expect((await manager.inspect(scope(offer))).allocation?.status).toBe('charged');
    }
    expect(e.backend.creates).toBe(3); expect(e.backend.starts).toBe(3);
    const captured = read.mock.calls.length;
    for (const offer of offers) await manager.drive(scope(offer), operation());
    expect(read).toHaveBeenCalledTimes(captured);
    for (const offer of offers) await e.finish(manager, offer);
  } finally { read.mockRestore(); }
  await manager.close();
});

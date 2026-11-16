import { expect, it, vi } from 'vitest';
import { fixture, scope, operation, deferred } from '../installation/fixtures.js';
const f = fixture();
it('retains actual driver work through a held Journal read, refuses later drive and reaches no runtime create', async () => {
  const e = await f.setup(); const manager = e.create(); await manager.enqueue(e.offer);
  const entered = deferred<void>(); const release = deferred<void>(); const original = e.owner.readOffer.bind(e.owner);
  const read = vi.spyOn(e.owner, 'readOffer').mockImplementationOnce(async key => {
    const value = await original(key); entered.resolve(); await release.promise; return value;
  });
  const driving = manager.drive(scope(e.offer), operation()); void driving.catch(() => undefined);
  try {
    await entered.promise; const gate = e.options.gate; const slot = gate.reserve(scope(e.offer)); slot.fence();
    let drained = false; const draining = slot.drain().then(() => { drained = true; });
    await expect(manager.drive(scope(e.offer), operation())).rejects.toMatchObject({ reason: 'closed' });
    await Promise.resolve(); expect(drained).toBe(false); expect(gate.status().leases).toBe(1);
    release.resolve(); await expect(driving).rejects.toMatchObject({ reason: 'retired' });
    await draining; expect(e.backend.creates).toBe(0); expect(gate.status().leases).toBe(0);
    expect(() => slot.release()).toThrow('cleanup');
  } finally { release.resolve(); await Promise.allSettled([driving]); read.mockRestore(); }
});

import { expect, it, vi } from 'vitest';
import { JournalError } from '../../src/journal/index.js';
import { fixture, operation, scope } from './fixtures.js';

const f = fixture();
it('defers staging read refusal without aborting a charged fresh setup', async () => {
  const e = await f.setup(); const manager = e.create(); await e.accepted(manager);
  const original = e.owner.readOffer.bind(e.owner);
  const read = vi.spyOn(e.owner, 'readOffer').mockImplementationOnce(original).mockRejectedValueOnce(new JournalError('queue_full'));
  const admission = vi.spyOn(e.owner, 'admission');
  expect(await manager.drive(scope(e.offer), operation())).toMatchObject({ kind: 'deferred', reason: 'staging_busy' });
  expect(admission.mock.calls.some(([command]) => command.kind === 'abortUnstarted')).toBe(false);
  expect((await manager.inspect(scope(e.offer))).allocation?.status).toBe('charged');
  expect(e.backend.starts).toBe(0); read.mockRestore(); admission.mockRestore();
  await e.finish(manager); expect(e.backend.starts).toBe(1); await manager.close();
});
it('defers a refused initial read without reservation/abort and later executes the same attempt', async () => {
  const e = await f.setup(); const manager = e.create(); await e.accepted(manager);
  const read = vi.spyOn(e.owner, 'readOffer').mockRejectedValueOnce(new JournalError('queue_full'));
  const admission = vi.spyOn(e.owner, 'admission');
  expect(await manager.drive(scope(e.offer), operation())).toEqual({ kind: 'deferred', reason: 'journal_busy' });
  expect(admission.mock.calls.some(([command]) => command.kind === 'abortUnstarted' || command.kind === 'admit')).toBe(false);
  expect(e.backend.starts).toBe(0); read.mockRestore(); admission.mockRestore();
  await e.finish(manager); expect(e.backend.starts).toBe(1); await manager.close();
});
it('preserves unavailable and expired-budget failures', async () => {
  const e = await f.setup(); const manager = e.create(); await e.accepted(manager);
  const read = vi.spyOn(e.owner, 'readOffer').mockRejectedValue(new JournalError('unavailable'));
  await expect(manager.drive(scope(e.offer), operation())).rejects.toMatchObject({ code: 'unavailable' });
  read.mockRejectedValue(new JournalError('queue_full'));
  await expect(manager.drive(scope(e.offer), operation(-1))).rejects.toBeDefined();
  expect(e.backend.starts).toBe(0); read.mockRestore(); await manager.close();
});

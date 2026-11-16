import { expect, it, vi } from 'vitest';
import { readdir } from 'node:fs/promises';
import { JournalError } from '../../src/journal/index.js';
import { fixture } from './fixtures.js';

const f = fixture();
it('returns busy on refused read without providers/files and permits a later preparation', async () => {
  const e = await f.environment(); const read = vi.spyOn(e.owner, 'readOffer');
  read.mockRejectedValueOnce(new JournalError('queue_full'));
  const input = vi.fn(e.options.providers.input); const stager = e.create({ providers: { ...e.options.providers, input } });
  const task = e.prepare(stager); expect(await task.result).toEqual({ ok: false, reason: 'busy' }); await task.quiesced;
  expect(input).not.toHaveBeenCalled(); expect(await readdir(e.rootPath)).toEqual(['.beetle-namespace-v1.json']);
  const retry = e.prepare(stager); expect((await retry.result).ok).toBe(true); await retry.quiesced;
  expect(input).toHaveBeenCalledTimes(1); read.mockRestore();
});
it('preserves unavailable failures and deadline failures instead of reporting busy', async () => {
  const e = await f.environment(); const read = vi.spyOn(e.owner, 'readOffer').mockRejectedValue(new JournalError('unavailable'));
  const stager = e.create(); const task = e.prepare(stager);
  expect(await task.result).toEqual({ ok: false, reason: 'io' }); await task.quiesced;
  read.mockRejectedValue(new JournalError('queue_full'));
  const expired = e.prepare(stager, e.offer, -1);
  expect(await expired.result).toEqual({ ok: false, reason: 'deadline' }); await expired.quiesced;
  expect(await readdir(e.rootPath)).toEqual(['.beetle-namespace-v1.json']); read.mockRestore();
});

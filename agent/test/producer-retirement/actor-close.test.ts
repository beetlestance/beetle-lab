import { expect, it, vi } from 'vitest';
import { supervisorFixture, deferred } from '../supervisor/fixtures.js';
const f = supervisorFixture();
it('fences actual actor handles and retains registry until its original telemetry close settles', async () => {
  const e = await f.setup(); const actor = e.manager.actor(e.input); const held = deferred<void>();
  const close = vi.spyOn(actor, 'closeTelemetry').mockReturnValue(held.promise);
  let done = false; const closing = e.manager.retireOwned(e.input).then(() => { done = true; });
  await Promise.resolve(); expect(e.manager.size).toBe(1); expect(done).toBe(false);
  await expect(actor.launch()).rejects.toMatchObject({ code: 'closed' });
  held.resolve(); await closing; expect(e.manager.size).toBe(0); expect(close).toHaveBeenCalledTimes(1);
});
it('keeps failed close cached and actor fenced rather than forgetting unresolved custody', async () => {
  const e = await f.setup(); const actor = e.manager.actor(e.input);
  const close = vi.spyOn(actor, 'closeTelemetry').mockRejectedValue(new Error('synthetic close uncertainty'));
  await expect(e.manager.retireOwned(e.input)).rejects.toThrow('synthetic close uncertainty');
  await expect(e.manager.retireOwned(e.input)).rejects.toThrow('synthetic close uncertainty');
  expect(e.manager.size).toBe(1); expect(close).toHaveBeenCalledTimes(1);
  await expect(actor.tick()).rejects.toMatchObject({ code: 'closed' });
});

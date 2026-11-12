import {describe,expect,it} from 'vitest';
import {rangeFixture,tracking,deferred} from './fixture.js';
// Failed native credits persist for this process; success/recovery cases live separately.
describe('failed original native close', () => {
  const f = rangeFixture();
  it('keeps failed original descriptor close sticky and closes independent native handles', async () => {
    const artifact = await f.artifact('reports/data.bin', 'body');
    const issued = deferred<void>(); const release = deferred<void>();
    const t = tracking({ closeDone: async path => {
      if (path.endsWith('data.bin')) { issued.resolve(); await release.promise; throw new Error('private native close failure'); }
    } });
    const operation = f.range(await f.rangeOptions(artifact), t.ports); await issued.promise;
    const closing = operation.close(); const rejection = expect(closing).rejects.toMatchObject({ reason: 'io' });
    expect(await operation.result).toEqual({ ok: false, reason: 'closed' }); release.resolve(); await rejection;
    await operation.quiesced; expect(operation.close()).toBe(closing);
    await expect(operation.close()).rejects.toMatchObject({ reason: 'io' });
    expect(t.closed).toHaveLength(3); expect(new Set(t.closed).size).toBe(3);
  });
  it('suppresses successful reply on original close rejection without cancellation', async () => {
    const artifact = await f.artifact('data.bin', 'body');
    const t = tracking({ closeDone: path => { if (path === f.directory()) throw new Error('native failure'); } });
    const operation = f.range(await f.rangeOptions(artifact), t.ports);
    expect(await operation.result).toEqual({ ok: false, reason: 'io' }); await operation.quiesced;
    await expect(operation.close()).rejects.toMatchObject({ reason: 'io' }); expect(t.closed.length).toBe(t.opened.length);
  });
});

import {describe,expect,it} from 'vitest';
import {fixture,tracking,deferred} from './fixture.js';
// Failed native credits persist for this process; success/recovery cases live separately.
describe('failed original native close', () => {
  const f = fixture();
  it('keeps late original close failure rejected forever and closes independent descriptors', async () => {
    const result = f.result(); await f.write(result); const issued = deferred<void>(); const release = deferred<void>();
    const t = tracking({ closeDone: async path => {
      if (path.endsWith('engine-result.json')) { issued.resolve(); await release.promise; throw new Error('private OS detail'); }
    } });
    const operation = f.collect(f.options(result), t.ports); await issued.promise;
    const closing = operation.close(); const rejected = expect(closing).rejects.toMatchObject({ message: 'Output collection io' });
    expect(await operation.result).toEqual({ ok: false, reason: 'closed' });
    release.resolve(); await rejected; await operation.quiesced;
    expect(operation.close()).toBe(closing); await expect(operation.close()).rejects.toMatchObject({ reason: 'io' });
    expect(t.closed).toHaveLength(2); expect(new Set(t.closed).size).toBe(2);
  });
  it('suppresses success when an original descriptor close rejects without public cancellation', async () => {
    const result = f.result(); await f.write(result);
    const t = tracking({ closeDone: path => { if (path === f.directory()) throw new Error('secret close detail'); } });
    const operation = f.collect(f.options(result), t.ports);
    expect(await operation.result).toEqual({ ok: false, reason: 'io' }); await operation.quiesced;
    await expect(operation.close()).rejects.toMatchObject({ reason: 'io' }); expect(t.closed.length).toBe(t.opened.length);
  });
});

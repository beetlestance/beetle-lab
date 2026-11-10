import { afterEach, expect, it } from 'vitest';
import { nativePort } from '../../../src/adapters/outbound/files/custody/index.js';
import { advance, context, deferred, finish, fixture, pending, record } from './fixture.js';
import type { Fixture } from './fixture.js';

let files: Fixture;
afterEach(async () => { await files?.dispose(); });
it.each(['binding', 'key', 'attempt'] as const)('rejects a nested %s proxy without borrowing held token B originals', async level => {
  const gate = deferred(); const entered = deferred(); let hold = false; let effects = 0;
  files = await fixture({ ...nativePort,
    open: async (...args) => { effects++; return nativePort.open(...args); },
    lstat: async (...args) => { effects++; return nativePort.lstat(...args); },
    sync: async handle => { effects++; await nativePort.sync(handle); },
    write: async (...args) => { effects++; const count = await nativePort.write(...args); if (hold) { entered.resolve(); await gate.promise; } return count; },
  });
  let b = record(); b = advance(b, await finish(files.store.prepare(b, context()))); hold = true;
  const original = files.store.append({ record: b, offset: 0, bytes: Buffer.from('abc') }, context()); await entered.promise;
  const attack = structuredClone(b); Object.assign(attack.artifact, { token: record(Buffer.from('abc'), 9).artifact.token });
  let traps = 0;
  const handler: ProxyHandler<object> = {
    getPrototypeOf(target) { traps++; Object.assign(attack.artifact, { token: b.artifact.token }); return Reflect.getPrototypeOf(target); },
    ownKeys(target) { traps++; Object.assign(attack.artifact, { token: b.artifact.token }); return Reflect.ownKeys(target); },
  };
  if (level === 'binding') Object.assign(attack, { binding: new Proxy(attack.binding, handler) });
  if (level === 'key') Object.assign(attack.binding, { key: new Proxy(attack.binding.key, handler) });
  if (level === 'attempt') Object.assign(attack.binding.key, { attempt: new Proxy(attack.binding.key.attempt, handler) });
  const before = effects; const adversary = files.store.prepare(attack, context());
  try {
    const outcome = await adversary.result.then(value => ({ ok: true, value }), error => ({ ok: false, error: error as unknown }));
    expect.soft(outcome).toMatchObject({ ok: false, error: { code: 'invalid_input' } });
    expect.soft(traps).toBe(0); expect.soft(effects).toBe(before);
    await adversary.settled;
    expect.soft(await pending(original.result)).toBe(true); expect.soft(await pending(original.settled)).toBe(true);
    await expect(finish(files.store.prepare(b, context()))).rejects.toMatchObject({ code: 'busy' });
    const c = record(Buffer.from('abc'), 10); expect((await finish(files.store.prepare(c, context()))).token).toBe(c.artifact.token);
    expect.soft(await pending(original.settled)).toBe(true);
  } finally {
    hold = false; gate.resolve(); await adversary.result.catch(() => undefined); await adversary.settled;
    expect((await finish(original)).token).toBe(b.artifact.token);
  }
});
it.each(['phase', 'artifactId', 'intentDigest'] as const)('rejects a proxy primitive %s before generic encoding or native IO', async field => {
  let effects = 0; let traps = 0;
  files = await fixture({ ...nativePort, open: async (...args) => { effects++; return nativePort.open(...args); } });
  const value = record();
  const proxy = new Proxy({}, { getPrototypeOf(target) { traps++; return Reflect.getPrototypeOf(target); }, ownKeys(target) { traps++; return Reflect.ownKeys(target); } });
  if (field === 'intentDigest') Object.assign(value.binding.key.attempt, { intentDigest: proxy });
  else Object.assign(value.artifact, { [field]: proxy });
  await expect(finish(files.store.prepare(value, context()))).rejects.toMatchObject({ code: 'invalid_input' });
  expect(traps).toBe(0); expect(effects).toBe(0);
});

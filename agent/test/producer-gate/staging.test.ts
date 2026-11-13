import { expect, it } from 'vitest';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fixture, stream } from '../staging/fixtures.js';
import { scope } from '../admission/fixtures.js';
import { deferred } from '../output-transfer/fixtures.js';
import { runtimeName } from '../../src/runtime-identity.js';
const f = fixture();
it('fences later staging while retaining the actual held provider and existing quiescence boundary', async () => {
  const e = await f.environment(); const started = deferred<void>(); const source = deferred<AsyncIterable<Uint8Array>>();
  const stager = e.create({ providers: { ...e.options.providers, input: async () => { started.resolve(); return source.promise; } } });
  const task = e.prepare(stager); const gate = e.options.gate;
  try {
    await started.promise; const slot = gate.reserve(scope(e.offer)); slot.fence();
    let drained = false; const draining = slot.drain().then(() => { drained = true; });
    expect(await e.prepare(stager).result).toEqual({ ok: false, reason: 'reservation' });
    await Promise.resolve(); expect(drained).toBe(false); expect(gate.status().leases).toBe(1);
    source.resolve(stream()); expect(await task.result).toEqual({ ok: false, reason: 'reservation' });
    await task.quiesced; await draining; expect(gate.status().leases).toBe(0);
    const name = runtimeName({ ...scope(e.offer), installationId: e.options.profile.installationId });
    expect(await readdir(join(e.rootPath, name, 'input'))).toEqual([]);
    expect(() => slot.release()).toThrow('cleanup');
  } finally { source.resolve(stream()); await task.quiesced; }
});

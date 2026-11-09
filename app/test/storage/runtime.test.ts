import { describe, expect, it, vi } from 'vitest';
import { RuntimeCapacity } from '../../src/adapters/outbound/sqlite/runtime.js';
import { observation, requestId, scope, seed, settingsCommand, settingsFixture, storageFixture } from './fixture.js';

const fixture = storageFixture();
describe('bounded source observation freshness', () => {
  it('expires source timestamps without refreshing stale queued observations', () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(10000);
    try {
      const source = observation(settingsFixture().runtime, 9901);
      const runtime = new RuntimeCapacity({ installation: settingsFixture().chain.installation, runtime: source, runtimeTtlMs: 100 });
      expect(runtime.snapshot()).toEqual(source.ceilings);
      clock.mockReturnValue(10001); expect(runtime.snapshot()).toBeNull();
      expect(() => runtime.update(source)).toThrow(); expect(runtime.snapshot()).toBeNull();
      clock.mockReturnValue(10002); runtime.update(observation(source.ceilings, 10002)); expect(runtime.snapshot()).toEqual(source.ceilings);
      runtime.update(null); expect(runtime.snapshot()).toBeNull();
    } finally { clock.mockRestore(); }
  });
  it('invalidates observations on clock rollback and keeps the prior high water time', () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(10000);
    try {
      const runtime = new RuntimeCapacity({ installation: settingsFixture().chain.installation,
        runtime: observation(settingsFixture().runtime, 10000), runtimeTtlMs: 1000 });
      clock.mockReturnValue(10100); expect(runtime.snapshot()).not.toBeNull();
      clock.mockReturnValue(10050); expect(runtime.snapshot()).toBeNull();
      runtime.update(observation(settingsFixture().runtime, 10050)); expect(runtime.snapshot()).toBeNull();
      clock.mockReturnValue(10101); expect(runtime.snapshot()).toBeNull();
      runtime.update(observation(settingsFixture().runtime, 10101)); expect(runtime.snapshot()).not.toBeNull();
    } finally { clock.mockRestore(); }
  });
  it('rejects stale bootstrap/updates, preserves current state and replays results while capacity is unknown', async () => {
    await expect(fixture.open(undefined, { runtime: observation(settingsFixture().runtime, Date.now() - 60001) }))
      .rejects.toMatchObject({ code: 'invalid_input' });
    const metadata = await fixture.open(); await seed(metadata);
    const settings = await metadata.getSettings(scope);
    const change = settingsCommand(settings.id, { schemaVersion: 2, scope, requestId: requestId(), expectedVersion: 1,
      patch: { retention: { mode: 'manual' } } });
    const original = await metadata.settings.execute(change);
    await expect(metadata.updateRuntime(observation(settingsFixture().runtime, Date.now() - 60001)))
      .rejects.toMatchObject({ code: 'invalid_input' });
    expect((await metadata.getSettings(scope)).version).toBe(2);
    await metadata.updateRuntime(null);
    await expect(metadata.getSettings(scope)).rejects.toMatchObject({ code: 'capacity_unavailable' });
    await expect(metadata.settings.execute(settingsCommand(settings.id, { ...change.request, expectedVersion: 2,
      requestId: requestId() }))).rejects.toMatchObject({ code: 'capacity_unavailable' });
    expect(await metadata.settings.execute(change)).toEqual(original);
    await metadata.updateRuntime(observation()); expect((await metadata.getSettings(scope)).version).toBe(2);
  });
  it('requires a real bounded source timestamp and validates TTL options and future updates', async () => {
    const metadata = await fixture.open();
    for (const observedAtMs of [-1, 0.5, Date.now() + 60000]) await expect(metadata.updateRuntime(
      observation(settingsFixture().runtime, observedAtMs))).rejects.toMatchObject({ code: 'invalid_input' });
    for (const runtimeTtlMs of [0, 60001, 1.5]) await expect(fixture.open(undefined, { runtimeTtlMs }))
      .rejects.toMatchObject({ code: 'invalid_input' });
    await expect(fixture.open(undefined, { runtime: observation(settingsFixture().runtime, Date.now() + 60000) }))
      .rejects.toMatchObject({ code: 'invalid_input' });
    expect((await metadata.getSettings({ kind: 'installation' })).version).toBe(1);
  });
});

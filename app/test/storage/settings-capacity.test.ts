import { expect, it, vi } from 'vitest';
import { initialize, transaction } from '../../src/adapters/outbound/sqlite/schema.js';
import { Settings } from '../../src/adapters/outbound/sqlite/settings.js';
import { observation, settingsFixture } from './fixture.js';

it('exposes the same immutable original runtime lease without refreshing its age', () => {
  const clock = vi.spyOn(Date, 'now').mockReturnValue(10000);
  const db = initialize(':memory:');
  try {
    const fixture = settingsFixture();
    const source = observation(fixture.runtime, 10000, 100);
    const settings = transaction(db, () => new Settings(db, {
      installation: fixture.chain.installation, runtime: source, runtimeTtlMs: 100,
    }));
    const first = settings.capacity();
    expect(first.runtime).toEqual(source);
    expect(first.runtime).not.toBe(source);
    clock.mockReturnValue(10099);
    expect(settings.capacity().runtime).toBe(first.runtime);
    expect(first.runtime?.expiresAtMs).toBe(10100);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.installation.values.pool)).toBe(true);
    expect(Object.isFrozen(first.runtime?.execution)).toBe(true);
    clock.mockReturnValue(10100);
    expect(settings.capacity().runtime).toBeNull();
    expect(first.runtime?.expiresAtMs).toBe(10100);
    clock.mockReturnValue(10101);
    settings.updateRuntime(observation(fixture.runtime, 10101, 100));
    expect(settings.capacity().runtime).not.toBe(first.runtime);
    settings.updateRuntime(null);
    expect(settings.capacity().runtime).toBeNull();
  } finally { db.close(); clock.mockRestore(); }
});

it('returns current installation policy even while runtime is unknown', () => {
  const db = initialize(':memory:');
  try {
    const installation = settingsFixture().chain.installation;
    const settings = transaction(db, () => new Settings(db, { installation, runtime: null }));
    const first = settings.capacity();
    expect(first.installation).toEqual(installation);
    expect(first.runtime).toBeNull();
    const values = { ...installation.values, pool: { ...installation.values.pool, concurrency: 1 } };
    db.prepare("UPDATE settings SET version=2,value_json=? WHERE scope_key='installation'")
      .run(JSON.stringify(values));
    const current = settings.capacity();
    expect(current.installation.version).toBe(2);
    expect(current.installation.values.pool.concurrency).toBe(1);
    expect(current.runtime).toBeNull();
    expect(first.installation.version).toBe(1);
    expect(first.installation.values.pool.concurrency).toBe(2);
  } finally { db.close(); }
});

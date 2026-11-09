import { describe, expect, it, vi } from 'vitest';
import { RuntimeCapacity } from '../../src/adapters/outbound/sqlite/runtime.js';
import { observation, settingsFixture } from './fixture.js';

function controlled() {
  const clock = vi.spyOn(Date, 'now').mockReturnValue(10000);
  const source = observation(settingsFixture().runtime, 10000, 200);
  const cache = new RuntimeCapacity({ installation: settingsFixture().chain.installation,
    runtime: source, runtimeTtlMs: 1000 });
  return { clock, source, cache };
}
describe('source lease and revocation fences', () => {
  it('preserves original expiry across identical replay and expires at its exact boundary', () => {
    const { clock, source, cache } = controlled();
    try {
      clock.mockReturnValue(10199); cache.update(source); expect(cache.snapshot()).toEqual(source.ceilings);
      clock.mockReturnValue(10200); expect(cache.snapshot()).toBeNull();
      expect(() => cache.update({ ...source, expiresAtMs: 11000 })).toThrow();
      clock.mockReturnValue(10201); cache.update(observation(source.ceilings, 10201));
      expect(cache.snapshot()).toEqual(source.ceilings);
    } finally { clock.mockRestore(); }
  });
  it('does not retain mutable caller aliases or expose a mutable cached ceiling', () => {
    const { clock, source, cache } = controlled();
    try {
      const originalCpu = source.ceilings.pool.cpuMillis;
      source.ceilings.pool.cpuMillis = 1;
      expect(cache.snapshot()?.pool.cpuMillis).toBe(originalCpu);
      expect(Object.isFrozen(cache.snapshot()?.pool)).toBe(true);
    } finally { clock.mockRestore(); }
  });
  it.each(['older', 'changed expiry', 'changed ceiling'] as const)('revokes on %s and fences delayed recovery', kind => {
    const { clock, source, cache } = controlled();
    try {
      clock.mockReturnValue(10050);
      const conflict = structuredClone(source);
      if (kind === 'older') conflict.observedAtMs--;
      if (kind === 'changed expiry') conflict.expiresAtMs++;
      if (kind === 'changed ceiling') conflict.ceilings.pool.cpuMillis--;
      expect(() => cache.update(conflict)).toThrow(); expect(cache.snapshot()).toBeNull();
      expect(() => cache.update(source)).toThrow();
      expect(() => cache.update(observation(source.ceilings, 10050))).toThrow();
      clock.mockReturnValue(10051); cache.update(observation(source.ceilings, 10051));
      expect(cache.snapshot()).toEqual(source.ceilings);
    } finally { clock.mockRestore(); }
  });
  it('revokes recovered capacity when a delayed valid fact predates the previous revocation fence', () => {
    const { clock, source, cache } = controlled();
    try {
      clock.mockReturnValue(10050); cache.update(null);
      clock.mockReturnValue(10051); cache.update(observation(source.ceilings, 10051));
      expect(cache.snapshot()).not.toBeNull();
      clock.mockReturnValue(10052);
      expect(() => cache.update(observation(source.ceilings, 10025))).toThrow();
      expect(cache.snapshot()).toBeNull();
      expect(() => cache.update(observation(source.ceilings, 10051))).toThrow();
      clock.mockReturnValue(10053); cache.update(observation(source.ceilings, 10053));
      expect(cache.snapshot()).not.toBeNull();
    } finally { clock.mockRestore(); }
  });
  it('fences unknown at local revocation time even when the delayed source is newer than the previous source', () => {
    const { clock, source, cache } = controlled();
    try {
      clock.mockReturnValue(10050); cache.update(null);
      expect(() => cache.update(observation(source.ceilings, 10025))).toThrow();
      expect(cache.snapshot()).toBeNull();
      clock.mockReturnValue(10051); cache.update(observation(source.ceilings, 10051));
      expect(cache.snapshot()).not.toBeNull();
    } finally { clock.mockRestore(); }
  });
  it.each([NaN, -1, 8640000000000001])('revokes invalid local time %s without poisoning recovery', invalid => {
    const { clock, source, cache } = controlled();
    try {
      clock.mockReturnValue(invalid); expect(cache.snapshot()).toBeNull();
      clock.mockReturnValue(10001); cache.update(observation(source.ceilings, 10001));
      expect(cache.snapshot()).not.toBeNull();
    } finally { clock.mockRestore(); }
  });
  it.each([0, 9999, 10000, 10000.5, NaN, Infinity, 8640000000000001])('rejects invalid expiry %s while preserving live capacity', expiresAtMs => {
    const { clock, source, cache } = controlled();
    try {
      expect(() => cache.update({ ...source, expiresAtMs })).toThrow();
      expect(cache.snapshot()).toEqual(source.ceilings);
    } finally { clock.mockRestore(); }
  });
});

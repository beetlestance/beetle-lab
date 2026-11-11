import { expect, it } from 'vitest';
import { compiled, dependencies, fixture } from './fixtures.js';
import { validateAndCompileSuite } from '../../compiler/suite/validation.js';
it('pins optional relative target sampling and includes it in reproducibility identity', () => {
  const config = fixture();const original = compiled(config);
  config.targetSampling = { path: '/debug/stats', intervalMs: 2000, timeoutMs: 1000, cooldownMs: 60000 };
  const withSampling = compiled(config);expect(withSampling.targetSampling).toEqual(config.targetSampling);
  expect(withSampling.identity.digest).not.toBe(original.identity.digest);expect(original.targetSampling).toBeUndefined();
});
it.each(['https://remote.invalid/stats','//remote.invalid/stats','/../stats','/stats?secret=1','/stats#fragment'])(
  'rejects sampler path %s before target interaction', path => {
    const config = fixture();config.targetSampling = { path, intervalMs: 2000, timeoutMs: 1000, cooldownMs: 0 };
    expect(validateAndCompileSuite(config, dependencies()).ok).toBe(false);
  });
it('rejects response timeouts exceeding the interval without relaxing timing caps', () => {
  const config = fixture();config.targetSampling = { path: '/stats', intervalMs: 1000, timeoutMs: 2000, cooldownMs: 0 };
  expect(validateAndCompileSuite(config, dependencies()).ok).toBe(false);
  config.targetSampling.timeoutMs = 1000;config.targetSampling.cooldownMs = 60001;
  expect(validateAndCompileSuite(config, dependencies()).ok).toBe(false);
});

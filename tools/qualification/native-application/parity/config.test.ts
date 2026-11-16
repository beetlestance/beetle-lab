import {expect, it} from 'vitest';
import {cases, configuration} from './config.js';
import {expectations} from './result.js';
it('validates every finite case against the owning schema before Docker effects', async () => {
 for (const profile of ['executors', 'thresholds', 'failures']) {
  expect(cases(profile)).toHaveLength(2);
  for (const kind of cases(profile)) expect((await configuration(kind)).target).toBe('http://target:8080');
 }
 expect(() => cases('all')).toThrow();
});
it('preserves discovery exhaustion as inconclusive and distinguishes expected abort from SLO failure', () => {
 expect(expectations('discovery-exhausted')).toEqual({outcome: 'inconclusive', exitCode: 0});
 expect(expectations('discovery-reached')).toEqual({outcome: 'passed', exitCode: 99});
 expect(expectations('transport')).toEqual({outcome: 'inconclusive', exitCode: 0});
 expect(expectations('slo')).toEqual({outcome: 'failed', exitCode: 99});
});

import { expect, it } from 'vitest';
import { configuredArrivalGuidance } from '../../compiler/index.js';
import { arrival, compiled, discovery, planWith, scenarios } from './fixtures.js';
it('uses canonical time units and peak rates without mutating compiled options', () => {
  const plan = compiled(planWith([{...arrival, timeUnit: '2s'}])); const before = JSON.stringify(plan);
  expect(configuredArrivalGuidance(plan)).toEqual({scenarioCount: 1, arrival: {executor: 'constant-arrival-rate', peakIterationsPerSecond: 10, preAllocatedVUs: 2, maxVUs: 8}});
  expect(JSON.stringify(plan)).toBe(before);
  expect(configuredArrivalGuidance(compiled(planWith([discovery]))).arrival).toMatchObject({executor: 'ramp-until', peakIterationsPerSecond: 20});
  expect(configuredArrivalGuidance(compiled(planWith([scenarios[1]!]))).arrival?.peakIterationsPerSecond).toBe(20);
});
it('refuses automatic guidance for mixed or non-arrival scenarios', () => {
  expect(configuredArrivalGuidance(compiled(planWith())).arrival).toBeNull();
  expect(configuredArrivalGuidance(compiled(planWith([scenarios[3]!]))).arrival).toBeNull();
});

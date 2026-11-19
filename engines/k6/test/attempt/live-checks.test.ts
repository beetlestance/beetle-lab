import { expect, it } from 'vitest';
import { K6_LIVE_CHECKS, k6LiveSubset } from '@beetle/contracts/k6-live';
import type { SeriesTotal } from '@beetle/contracts/metrics';
import { projectWindow } from '../../wrapper/live/project.js';

const subset = k6LiveSubset({
  requests: Array.from({ length: 12 }, (_, index) => ({ id: `r${index}`, assertions: [{ id: 'status' }] })),
  readiness: { assertions: [{ id: 'ready' }] },
});
const check = (assertion: string, numerator: number, sampleCount: number, phase = 'execute' as 'execute' | 'prepare'): SeriesTotal =>
  ({ metric: 'checks', scope: phase, kind: 'rate', tags: { phase, assertion }, total: { kind: 'rate', numerator, sampleCount } });
const window = (series: SeriesTotal[]) => ({ startTimeMs: 1000, endTimeMs: 2000, series });

it('pools native execute checks beyond the selected endpoint prefix and excludes readiness', () => {
  const projected = projectWindow(window([check('a0', 9, 10), check('a11', 0, 1), check('a12', 45, 45, 'prepare')]), subset);
  expect(projected.series).toEqual([{
    ordinal: subset.selected.find(row => row.metric === K6_LIVE_CHECKS)?.ordinal,
    metric: K6_LIVE_CHECKS, scope: 'execute', tags: { phase: 'execute' }, kind: 'rate', unit: 'ratio',
    total: { kind: 'rate', numerator: 9, sampleCount: 11, ratio: 9 / 11 },
  }]);
});

it('omits unobserved checks and rejects duplicate or forged check inputs', () => {
  expect(projectWindow(window([check('a0', 0, 0)]), subset).series).toEqual([]);
  expect(() => projectWindow(window([check('a0', 2, 2), check('a0', 1, 3)]), subset)).toThrow();
  expect(() => projectWindow(window([{ ...check('a0', 1, 1), metric: K6_LIVE_CHECKS }]), subset)).toThrow();
});

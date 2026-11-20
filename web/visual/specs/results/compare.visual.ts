// Compare: two steady-1.2k runs (baseline b089 and the failed 405b), the empty page, and a metric gap.
import { shoot, test } from '../../harness.js';
import { buildCase } from '../../world/results/data.js';
import { compareEmptyPath, comparePath, installComparison } from '../../world/results/compare.js';

test('compare', async ({ page, api }) => {
  const runs = [buildCase({ variant: 'baseline' }), buildCase({ variant: 'failed', note: 'After the cache flush' })];
  installComparison(api, runs);
  await shoot(page, comparePath(runs), 'compare', { viewports: ['desktop', 'phone'] });
});

test('compare-empty', async ({ page, api }) => {
  const runs = [buildCase({ variant: 'baseline' }), buildCase({ variant: 'failed' })];
  installComparison(api, runs);
  await shoot(page, compareEmptyPath, 'compare-empty');
});

test('compare-metric-not-recorded', async ({ page, api }) => {
  const runs = [buildCase({ variant: 'baseline' }), buildCase({ variant: 'failed', note: 'After the cache flush' })];
  installComparison(api, runs, { dropOverview: runs[1]!.ids.run });
  await shoot(page, comparePath(runs), 'compare-metric-not-recorded');
});

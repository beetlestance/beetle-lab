import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect } from '@playwright/test';
import { configuration } from '../native-application/target-runtime/config.ts';

/** Two small runs, declared units and no deliberately missed observations. */
export function comparisonConfiguration() {
  const config = configuration();
  assert(config.targetSampling);
  config.targetSampling.units = { heapAlloc: 'bytes', 'eventLoopDelay.p99': 'milliseconds' };
  return config;
}

/** Self-contained program serialized into the owned synthetic target container. */
async function serve() {
  const http = await import('node:http');
  const counts = { ready: 0, work: 0, runtime: 0, unexpected: 0 };
  http
    .createServer((request, response) => {
      if (request.url === '/counts') {
        response.end(JSON.stringify(counts));
        return;
      }
      /** @type {Record<string, 'ready' | 'work' | 'runtime'>} */
      const paths = { '/ready': 'ready', '/work': 'work', '/runtime': 'runtime' };
      const key = paths[request.url ?? ''];
      if (!key) {
        counts.unexpected++;
        response.writeHead(404);
        response.end();
        return;
      }
      const limit = { ready: 2, work: 80, runtime: 64 };
      if (++counts[key] > limit[key]) process.exit(3);
      response.setHeader('content-type', 'application/json');
      response.end(key === 'runtime' ? JSON.stringify({ heapAlloc: 0, eventLoopDelay: { p99: 3 } }) : 'ok');
    })
    .listen(8080, '0.0.0.0');
}

/** @param {import('../native-application/compose/fixture.ts').Fixture} fixture */
export async function configureComparisonTarget(fixture) {
  const path = join(fixture.root, 'target.json');
  const override = JSON.parse(await readFile(path, 'utf8'));
  const program = `(${serve.toString()})()`;
  assert(Buffer.byteLength(program) <= 8192);
  override.services['synthetic-target'].entrypoint = ['node', '-e', program];
  await writeFile(path, JSON.stringify(override), { mode: 0o600 });
}

/** @param {import('@playwright/test').Page} page */
export async function targetComparison(page) {
  const section = page.getByRole('region', { name: 'Target runtime comparison', exact: true });
  await expect(section).toBeVisible();
  /** @type {Array<[string, string]>} */
  const readings = [
    ['Target heap', '0 MB'],
    ['Target event-loop delay, p99', '3 ms'],
  ];
  for (const [title, value] of readings) {
    const chart = section.locator('figure').filter({ hasText: title });
    await expect(chart).toHaveCount(1);
    await expect(chart.locator('.live-legend strong')).toHaveText([value, value]);
    await expect(chart.locator('.live-line')).toHaveCount(2);
  }
  await expect(
    section.getByText('Target process CPU: no shared metric with usable declared readings.', { exact: true }),
  ).toBeVisible();
  await expect(
    section.getByText('Target activity: no shared metric with usable declared readings.', { exact: true }),
  ).toBeVisible();
  const details = section.locator('details');
  if (!(await details.evaluate((node) => node.hasAttribute('open'))))
    await details.getByText('Recorded source details', { exact: true }).click();
  await expect(section.getByText(/observations; 0 missed\./)).toHaveCount(2);
  await expect(section.getByRole('link', { name: 'Inspect this run’s target evidence', exact: true })).toHaveCount(2);
  return { runs: 2, declaredHeapZeroMB: true, declaredP99Milliseconds: 3, missingMetricsNotPlotted: true };
}

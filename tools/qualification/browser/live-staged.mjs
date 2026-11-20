import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect } from '@playwright/test';
import { liveSamplerConfiguration } from './live-controls.mjs';
import { revision } from './authoring.mjs';
import { start } from './results.mjs';
import { assertRunState } from './run-state.mjs';
import { targetCounts } from '../native-application/target-runtime/target.ts';

const endpoints = { checkout: 60, cart: 35, catalog: 20, product: 45, health: 5 };

/** Container program for the owned synthetic target. */
async function serve(delays = endpoints) {
  const http = await import('node:http');
  const counts = { ready: 0, work: 0, runtime: 0, unexpected: 0 };
  http
    .createServer((request, response) => {
      if (request.url === '/counts') {
        response.end(JSON.stringify(counts));
        return;
      }
      if (request.url === '/ready') {
        if (++counts.ready !== 1) process.exit(3);
        response.end('ready');
        return;
      }
      if (request.url === '/runtime') {
        const n = ++counts.runtime;
        if (n > 40) process.exit(3);
        response.setHeader('content-type', 'application/json');
        response.end(
          JSON.stringify({
            heapAlloc: 384000000 + (n % 9) * 2000000,
            rss: 548000000 + (n % 4) * 4000000,
            cpuPercent: (61 + (n % 7)) / 100,
            systemCpuPercent: 35 + (n % 5),
            activeHandles: 148 + (n % 9),
            eventLoopDelay: { mean: 7 + (n % 4), p99: 18 + (n % 6), max: 29 + (n % 7) },
          }),
        );
        return;
      }
      const key = request.url?.slice(1);
      if (key && Object.hasOwn(delays, key)) {
        if (++counts.work > 180) process.exit(3);
        globalThis.setTimeout(() => response.end('ok'), delays[/** @type {keyof typeof delays} */ (key)]);
        return;
      }
      counts.unexpected++;
      response.writeHead(404).end();
    })
    .listen(8080, '0.0.0.0');
}

/** @param {import('../native-application/compose/fixture.ts').Fixture} fixture */
export async function configureStagedTarget(fixture) {
  const path = join(fixture.root, 'target.json');
  const override = JSON.parse(await readFile(path, 'utf8'));
  const program = `(${serve.toString()})(${JSON.stringify(endpoints)})`;
  assert(Buffer.byteLength(program) <= 8192);
  override.services['synthetic-target'].entrypoint = ['node', '-e', program];
  await writeFile(path, JSON.stringify(override), { mode: 0o600 });
}

function stagedConfiguration() {
  const config = liveSamplerConfiguration();
  config.loadPlan.scenarios = [
    {
      id: 'main',
      name: 'main',
      executor: 'ramping-arrival-rate',
      startRate: 1,
      timeUnit: '1s',
      startTime: '0s',
      stages: [
        { duration: '5s', target: 4 },
        { duration: '31s', target: 4 },
        { duration: '4s', target: 1 },
      ],
      preAllocatedVUs: 2,
      maxVUs: 2,
      gracefulStop: '1s',
    },
  ];
  config.loadPlan.slos = [
    { id: 'latency', metric: 'http_req_duration', stat: 'p95', operator: '<', value: 250 },
    { id: 'failed', metric: 'http_req_failed', stat: 'rate', operator: '<', value: 0.01 },
    { id: 'checks', metric: 'checks', stat: 'rate', operator: '>', value: 0.99 },
  ];
  config.requests = Object.keys(endpoints).map((id) => ({
    id,
    name: id,
    method: 'GET',
    path: '/' + id,
    query: {},
    headers: {},
    assertions: [{ id: 'ok', kind: 'statusEq', value: 200, required: true }],
  }));
  config.selections = [
    {
      scenarioId: 'main',
      entries: config.requests.map(({ id }) => ({
        requestId: id,
        weight: 1,
        maxIterationsPerVu: 180,
        wait: { durationMs: 0, jitterMs: 0 },
      })),
    },
  ];
  return config;
}

/**
 * @param {import('@playwright/test').Page} page
 * @param {Awaited<ReturnType<import('./authoring.mjs').author>>} authored
 * @param {import('../native-application/compose/fixture.ts').Fixture} fixture
 * @param {string} evidence
 */
export async function liveStaged(page, authored, fixture, evidence) {
  await page.setViewportSize({ width: 1440, height: 2584 });
  await page.goto(authored.suite);
  await revision(page, stagedConfiguration(), 2);
  const run = await start(page);
  const stage = page.locator('.live-stage.is-now');
  const rows = page.locator('.live-endpoints tbody tr');
  await expect(stage).toContainText(/Hold|Steady/, { timeout: 26000 });
  await expect(rows).toHaveCount(5, { timeout: 22000 });
  for (const name of Object.keys(endpoints)) await expect(rows.filter({ hasText: '/' + name })).toHaveCount(1);
  await expect(page.locator('.live-threshold.is-holding')).toHaveCount(3);
  await expect(page.getByRole('region', { name: 'Target runtime', exact: true }).locator('figure')).toHaveCount(4);
  const progress = page.locator('.live-percent');
  await expect(progress).toHaveText(/^(?:4[5-9]|5\d|6[0-5])%$/, { timeout: 18000 });
  const captures = [];
  for (const view of [
    { key: 'desktop', width: 1440, height: 2584 },
    { key: 'ultrawide', width: 2560, height: 1751 },
    { key: 'phone', width: 390, height: 844 },
  ]) {
    await page.setViewportSize({ width: view.width, height: view.height });
    await expect(stage).toContainText(/Hold|Steady/);
    assert(await page.evaluate(() => globalThis.document.documentElement.scrollWidth <= globalThis.innerWidth));
    captures.push({ viewport: view.key, progress: await progress.textContent() });
    await page.screenshot({ path: join(evidence, `staged-${view.key}.png`), fullPage: true, animations: 'disabled' });
  }
  const result = page.locator('.result-head').getByText('Passed', { exact: true });
  const open = page.getByRole('button', { name: 'Open result', exact: true });
  await expect(open.or(result)).toBeVisible({ timeout: 60000 });
  if (await open.isVisible()) await open.click();
  await expect(result).toBeVisible();
  await assertRunState(page, { state: 'finished', outcome: 'passed' }, run);
  const observed = targetCounts(fixture);
  assert(observed.ready === 1 && observed.work >= 90 && observed.work <= 180 && observed.runtime >= 12);
  assert.equal(observed.unexpected, 0);
  await writeFile(join(evidence, 'staged-live-coverage.json'), JSON.stringify({ observed, captures }), {
    mode: 0o600,
    flag: 'wx',
  });
}

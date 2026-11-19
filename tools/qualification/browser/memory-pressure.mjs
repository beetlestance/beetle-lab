import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect } from '@playwright/test';
import { validateApi } from '@beetle/contracts/api';
import { counts } from '../resources/lifecycle/observations.ts';
import { configuration } from '../native-application/target-runtime/config.ts';
import { revision } from './authoring.mjs';
import { start } from './results.mjs';
import { assertRunState } from './run-state.mjs';

const memoryBytes = 512 * 1024 * 1024;

/** One shared fixture buffer, served only to the second synthetic scenario. @param {string} source */
export function memoryTarget(source) {
  const entry = 'const counts={ready:0,work:0,unexpected:0};';
  const route = "const key=q.url==='/ready'?'ready':q.url==='/work'?'work':'unexpected';";
  assert(source.includes(entry) && source.includes(route));
  const payload = `const block=Buffer.alloc(1024*1024,120);let pressure=0;
function send(r){if(++pressure>32){r.writeHead(429);r.end();return;}
r.writeHead(200,{'content-length':32*block.length});let remaining=32;
function pump(){if(r.destroyed)return;
while(remaining>1){remaining--;if(!r.write(block)){r.once('drain',pump);return;}}
setTimeout(()=>{if(!r.destroyed)r.end(block);},1500);}
pump();}`;
  return source.replace(entry, entry + payload).replace(route, "if(q.url==='/memory'){send(r);return;}" + route);
}

function pressureConfiguration() {
  const config = configuration();
  delete config.targetSampling;
  config.loadPlan.scenarios = [
    {
      id: 'main',
      name: 'Baseline',
      executor: 'per-vu-iterations',
      vus: 1,
      iterations: 30,
      maxDuration: '22s',
      startTime: '0s',
      gracefulStop: '0s',
    },
    {
      id: 'burst',
      name: 'Retained_response_memory',
      executor: 'per-vu-iterations',
      vus: 32,
      iterations: 1,
      maxDuration: '8s',
      startTime: '10s',
      gracefulStop: '0s',
    },
  ];
  config.requests.push({
    method: 'GET',
    headers: {},
    query: {},
    id: 'memory',
    name: 'Bounded memory response',
    path: '/memory',
    assertions: [{ id: 'body', required: true, kind: 'bodyContains', value: 'xxxxxxxx' }],
  });
  config.selections = [
    { scenarioId: 'main', entries: [{ requestId: 'work', weight: 1, wait: { durationMs: 550, jitterMs: 0 } }] },
    { scenarioId: 'burst', entries: [{ requestId: 'memory', weight: 1, wait: { durationMs: 0, jitterMs: 0 } }] },
  ];
  return config;
}

/**
 * @param {import('@playwright/test').Page} page
 * @param {Awaited<ReturnType<import('./authoring.mjs').author>>} authored
 * @param {import('../native-application/compose/fixture.ts').Fixture} fixture
 * @param {string} installation
 * @param {string} evidence
 */
export async function memoryPressure(page, authored, fixture, installation, evidence) {
  await page.goto(authored.suite);
  await revision(page, pressureConfiguration(), 2);
  const submitted = await start(page, 8388608, memoryBytes);
  const open = page.getByRole('button', { name: 'Open result', exact: true });
  await expect(open).toBeVisible({ timeout: 60000 });
  await open.click();
  await assertRunState(page, { state: 'errored', outcome: 'inconclusive' }, submitted);
  const base = submitted.origin + '/api/v2' + submitted.path;
  const reply = await page.request.get(base);
  const run = validateApi('Run', await reply.json());
  assert(reply.ok() && run.ok && run.value.id === submitted.id);
  const physical = memoryExit(fixture, installation, run.value.activeAttemptId);
  assert.equal(run.value.reason, 'memory_limit');
  await expect(page.getByText(/went over its .* memory limit and was stopped/)).toBeVisible();
  const evidenceState = await memoryEvidence(page, base, run.value.activeAttemptId);
  const observed = counts(fixture);
  assert(observed.work > 0 && observed.unexpected === 0);
  await writeFile(
    join(evidence, 'memory-pressure-coverage.json'),
    JSON.stringify({ observed, measurements: evidenceState, reason: run.value.reason, physical }),
    { mode: 0o600, flag: 'wx' },
  );
  await page.screenshot({ path: join(evidence, 'memory-pressure-result.png'), fullPage: true });
}

/**
 * @param {import('@playwright/test').Page} page
 * @param {string} base
 * @param {string} attempt
 */
async function memoryEvidence(page, base, attempt) {
  const result = await page.request.get(base + '/result');
  const snapshot = validateApi('RunResultSnapshot', await result.json());
  assert(result.ok() && snapshot.ok && snapshot.value.activeAttemptId === attempt);
  const source = snapshot.value.result;
  const path = base + '/attempts/' + attempt + '/metrics/';
  const retained = await page.request.get(path + 'stopped-history');
  if (retained.ok()) {
    const history = validateApi('LiveMetricHistory', await retained.json());
    assert(history.ok && history.value.scope.attemptId === attempt && history.value.samples.length > 0);
    await expect(page.getByRole('heading', { name: 'Recovered before the stop' })).toBeVisible();
    const report = source?.artifacts.find((artifact) => artifact.kind === 'performance-report');
    if (!source || !report) return { source: 'checkpoint', windows: history.value.samples.length };
    assert(source.completeness !== 'complete');
    await expect(page.getByRole('region', { name: 'Verified performance report', exact: true })).toBeVisible();
    return {
      source: 'checkpoint-and-report',
      windows: history.value.samples.length,
      completeness: source.completeness,
      reportSha256: report.sha256,
    };
  }
  assert.equal(retained.status(), 404);
  const error = validateApi('ApiError', await retained.json());
  assert(error.ok && error.value.code === 'not_found');
  return partialMemoryReport(page, source, path, attempt);
}

/**
 * @param {import('@playwright/test').Page} page
 * @param {import('@beetle/contracts/api').RunResultSnapshot['result']} source
 * @param {string} path
 * @param {string} attempt
 */
async function partialMemoryReport(page, source, path, attempt) {
  assert(source && source.completeness !== 'complete', 'Expected a sealed result whose measurements are incomplete');
  assert(
    source.artifacts.some((artifact) => artifact.kind === 'performance-report'),
    'Expected a published report',
  );
  await expect(page.getByRole('region', { name: 'Verified performance report', exact: true })).toBeVisible();
  const chart = await page.request.get(path + 'chart-history');
  const recorded = validateApi('RunChartHistory', await chart.json());
  assert(chart.ok() && recorded.ok && recorded.value.attemptId === attempt);
  if (recorded.value.reason === 'not_recorded')
    await expect(page.getByText('No chart history was recorded.', { exact: true })).toBeVisible();
  return {
    source: 'partial-report',
    completeness: source.completeness,
    windows: recorded.value.points.length,
    chartStatus: recorded.value.reason,
  };
}

/**
 * @param {import('../native-application/compose/fixture.ts').Fixture} fixture
 * @param {string} installation
 * @param {string} attempt
 */
function memoryExit(fixture, installation, attempt) {
  const id = fixture.docker.run([
    'ps',
    '-aq',
    '--no-trunc',
    '--filter',
    'label=dev.beetle.installation=' + installation,
    '--filter',
    'label=dev.beetle.attempt=' + attempt,
  ]);
  assert.match(id, /^[a-f0-9]{64}$/);
  const native = /** @type {import('../../../agent/test/container/docker.ts').Inspection[]} */ (
    fixture.docker.json(['inspect', id])
  );
  const row = native[0];
  assert(native.length === 1 && row && row.Image === fixture.imageIds.engine);
  assert.equal(row.HostConfig.Memory, memoryBytes);
  assert.equal(row.HostConfig.MemorySwap, memoryBytes);
  assert.equal(row.State.Running, false);
  assert.equal(row.State.OOMKilled, true);
  return { oomKilled: row.State.OOMKilled, exitCode: row.State.ExitCode, memoryBytes };
}

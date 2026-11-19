import assert from 'node:assert/strict';
import { join } from 'node:path';
import { writeFile } from 'node:fs/promises';
import { expect } from '@playwright/test';
import { validateApi } from '@beetle/contracts/api';
import { attach } from '../native-application/flood/attach.ts';
import { configuration } from '../native-application/flood/config.ts';
import { counts, runningRuntime } from '../resources/lifecycle/observations.ts';
import { revision } from './authoring.mjs';
import { start } from './results.mjs';
import { assertRunState } from './run-state.mjs';

/**
 * @param {import('@playwright/test').Page} page
 * @param {Awaited<ReturnType<import('./results.mjs').start>>} submitted
 */
async function readRun(page, submitted) {
  const reply = await page.request.get(submitted.origin + '/api/v2' + submitted.path);
  assert.equal(reply.status(), 200);
  const parsed = validateApi('Run', await reply.json());
  assert(parsed.ok && parsed.value.id === submitted.id);
  return parsed.value;
}

/**
 * @param {import('@playwright/test').Page} page
 * @param {Awaited<ReturnType<import('./authoring.mjs').author>>} authored
 * @param {import('../native-application/compose/fixture.ts').Fixture} fixture
 * @param {string} installation
 * @param {string} evidence
 */
export async function outputPressure(page, authored, fixture, installation, evidence) {
  const config = configuration();
  for (const request of config.requests) request.path = '/work';
  await page.goto(authored.suite);
  await revision(page, config, 2);
  const submitted = await start(page, 4194304);
  const run = await readRun(page, submitted);
  await expect
    .poll(() => runningRuntime(fixture, run, installation)?.id, { timeout: 12000, intervals: [250] })
    .toBeDefined();
  const engine = runningRuntime(fixture, run, installation);
  assert(engine);
  const capture = attach(fixture.context, engine.id);
  try {
    const open = page.getByRole('button', { name: 'Open result', exact: true });
    await expect(open).toBeVisible({ timeout: 60000 });
    const attached = await capture.result;
    assert.deepEqual(attached.failures, ['output_limit']);
    await open.click();
    await assertRunState(page, { state: 'errored', outcome: 'inconclusive' }, submitted);
    const ended = await readRun(page, submitted);
    assert(['output_limit', 'artifact_incomplete'].includes(ended.reason ?? ''));
    await expect(page.locator('.result-head')).toBeVisible();
    const retained = await retainedHistory(page, submitted, ended);
    const observed = counts(fixture);
    assert(observed.work > 0 && observed.unexpected === 0);
    await writeFile(
      join(evidence, 'output-pressure-coverage.json'),
      JSON.stringify({ observed, retained, reason: ended.reason, wrapperStop: attached.failures[0] }),
      { mode: 0o600, flag: 'wx' },
    );
    await page.screenshot({ path: join(evidence, 'output-pressure-result.png'), fullPage: true });
  } finally {
    await capture.close();
  }
}

/**
 * @param {import('@playwright/test').Page} page
 * @param {Awaited<ReturnType<import('./results.mjs').start>>} submitted
 * @param {import('@beetle/contracts/api').Run} run
 */
async function retainedHistory(page, submitted, run) {
  const base = submitted.origin + '/api/v2' + submitted.path;
  const response = await page.request.get(base + '/attempts/' + run.activeAttemptId + '/metrics/stopped-history');
  const recovered = page.getByRole('heading', { name: 'Recovered before the stop' });
  if (response.status() === 404) {
    const error = validateApi('ApiError', await response.json());
    assert(error.ok && error.value.code === 'not_found');
    await expect(recovered).toHaveCount(0);
    return 0;
  }
  assert.equal(response.status(), 200);
  const history = validateApi('LiveMetricHistory', await response.json());
  assert(history.ok && history.value.scope.attemptId === run.activeAttemptId);
  await expect(recovered).toBeVisible();
  return history.value.samples.length;
}

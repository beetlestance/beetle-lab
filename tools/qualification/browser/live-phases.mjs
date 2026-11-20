import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect } from '@playwright/test';
import { validateApi } from '@beetle/contracts/api';
import { targetCounts } from '../native-application/target-runtime/target.ts';
import { liveSamplerConfiguration } from './live-controls.mjs';
import { revision } from './authoring.mjs';
import { start } from './results.mjs';
import { assertRunState } from './run-state.mjs';

/** @typedef {import('@playwright/test').Page} Page */
/** @typedef {import('./run-state.mjs').SubmittedRun} SubmittedRun */

/**
 * @param {Page} page
 * @param {Awaited<ReturnType<import('./authoring.mjs').author>>} authored
 * @param {import('../native-application/compose/fixture.ts').Fixture} fixture
 * @param {string} evidence
 */
export async function livePhases(page, authored, fixture, evidence) {
  const config = liveSamplerConfiguration();
  assert(config.readiness);
  Object.assign(config.readiness, { attempts: 8, intervalMs: 1000, wallBudgetMs: 16000 });
  await page.goto(authored.suite);
  await revision(page, config, 2);
  await page.setViewportSize({ width: 1440, height: 799 });
  const first = await start(page, 8388608, undefined, true);
  await expect.poll(() => targetCounts(fixture).ready, { timeout: 14000 }).toBeGreaterThan(0);
  assert.equal(targetCounts(fixture).work, 0);
  await captureStarting(page, evidence);
  await expect(page.getByText('Running', { exact: true })).toBeVisible({ timeout: 18000 });
  assert(targetCounts(fixture).work > 0);

  await page.goto(authored.suite);
  const second = await start(page);
  const queue = await captureQueue(page, first, second, evidence);
  await cancelQueued(page, second);
  const queuedTargetCounts = targetCounts(fixture);
  assert.equal(queuedTargetCounts.ready, 5, 'The queued second run never reached the target');

  await page.setViewportSize({ width: 1440, height: 2584 });
  await page.goto(first.origin + first.path);
  await expect(page.getByText('Running', { exact: true })).toBeVisible({ timeout: 15000 });
  await expect(page.getByRole('img', { name: /^CPU:.*process 64%.*system 38%/ })).toBeVisible();
  assert(targetCounts(fixture).runtime >= 4);
  const stopped = await captureStop(page, first, evidence);
  await writeFile(join(evidence, 'live-phase-coverage.json'), JSON.stringify({ queue, queuedTargetCounts, stopped }), {
    mode: 0o600,
    flag: 'wx',
  });
}

/** @param {Page} page @param {string} evidence */
async function captureStarting(page, evidence) {
  const phase = page.getByRole('region', { name: 'Starting', exact: true });
  await expect(phase).toBeVisible();
  await expect(phase.getByText('Accepted by the agent', { exact: true })).toBeVisible();
  await expect(phase.getByText('First metrics arrive', { exact: true })).toBeVisible();
  await page.screenshot({ path: join(evidence, 'live-starting.png'), fullPage: true });
}

/** @param {Page} page @param {SubmittedRun} first @param {SubmittedRun} second @param {string} evidence */
async function captureQueue(page, first, second, evidence) {
  const phase = page.getByRole('region', { name: 'Waiting for capacity', exact: true });
  await expect(phase.getByText('Queued, first in line.', { exact: true })).toBeVisible();
  const holder = phase.locator(`a[href="${first.path}"]`);
  await expect(holder).toBeVisible();
  const reply = await page.request.get(second.origin + '/api/v2' + second.path + '/queue');
  const queue = validateApi('RunQueueStatus', await reply.json());
  assert(reply.ok() && queue.ok && queue.value.runId === second.id);
  await expect(page.getByText(/Another job has reserved the pool for isolated execution/)).toBeVisible();
  assert.equal(queue.value.capacityBlockReason, 'isolated');
  assert.equal(queue.value.state, 'queued');
  assert.equal(queue.value.waiting, 'backend_queue');
  assert.equal(queue.value.position, 1);
  assert(queue.value.holders.some((row) => row.runId === first.id));
  await page.screenshot({ path: join(evidence, 'live-waiting-for-capacity.png'), fullPage: true });
  return {
    waiting: queue.value.waiting,
    reason: queue.value.capacityBlockReason,
    position: queue.value.position,
    usedSlots: queue.value.slots.used,
    effectiveSlots: queue.value.slots.effective,
  };
}

/** @param {Page} page @param {SubmittedRun} second */
async function cancelQueued(page, second) {
  await page.getByRole('button', { name: 'Cancel run', exact: true }).click();
  await expect(page.getByText('Cancelled', { exact: true }).first()).toBeVisible({ timeout: 15000 });
  await assertRunState(page, { state: 'cancelled', outcome: 'inconclusive' }, second);
}

/** @param {Page} page @param {SubmittedRun} first @param {string} evidence */
async function captureStop(page, first, evidence) {
  const cancelling = page.getByRole('heading', { name: /^Cancelling / });
  const finalizing = page.getByRole('region', { name: 'Sealing results', exact: true });
  const terminal = page.getByRole('button', { name: 'Open result', exact: true });
  await page.getByRole('button', { name: 'Cancel run', exact: true }).click();
  await expect(cancelling.or(finalizing).or(terminal)).toBeVisible({ timeout: 15000 });
  const cancellationVisible = await cancelling.isVisible();
  if (cancellationVisible) {
    await expect(page.getByRole('button', { name: 'Cancelling…', exact: true })).toBeDisabled();
    await page.mouse.move(4, 4);
    await page.screenshot({ path: join(evidence, 'live-cancelling.png'), fullPage: true });
  }
  await expect(finalizing.or(terminal)).toBeVisible({ timeout: 60000 });
  const finalizingVisible = await finalizing.isVisible();
  if (finalizingVisible) {
    const progress = finalizing.getByRole('progressbar', { name: 'Sealing results', exact: true });
    assert.equal(await progress.getAttribute('aria-valuenow'), null);
    await expect(finalizing.getByText('Target sampler closed', { exact: true })).toBeVisible({ timeout: 12000 });
    await page.screenshot({ path: join(evidence, 'live-finalizing.png'), fullPage: true });
  }
  await expect(terminal).toBeVisible({ timeout: 60000 });
  await terminal.click();
  await assertRunState(page, { state: 'cancelled', outcome: 'inconclusive' }, first);
  return { cancellationVisible, finalizingVisible, samplerClosureVisible: finalizingVisible, resultOpened: true };
}

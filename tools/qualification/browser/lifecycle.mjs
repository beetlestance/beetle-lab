import { expect } from '@playwright/test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { validateApi } from '@beetle/contracts/api';
import { execute, start } from './results.mjs';
import { revision } from './authoring.mjs';
import { assertRunState, runRoute } from './run-state.mjs';
/**
 * @param {import('@playwright/test').Page} page
 * @param {Awaited<ReturnType<import('./authoring.mjs').author>>} authored
 * @param {string} first
 */
export async function historyComparison(page, authored, first) {
  await page.goto(authored.suite);
  const second = await execute(page);
  const ids = [first, second].map((url) => new URL(url).pathname.split('/').at(-1));
  await page.goto(authored.workspace);
  await page
    .getByRole('navigation', { name: 'Workspace sections' })
    .getByRole('link', { name: 'Runs', exact: true })
    .click();
  await page.getByRole('radio', { name: /^Passed\b/ }).click();
  for (const url of [first, second]) {
    const path = new URL(url).pathname;
    const row = page.getByRole('row').filter({ has: page.locator(`a[href="${path}"]`) });
    await row.getByRole('checkbox', { name: /^Compare run / }).check();
  }
  await page.getByRole('link', { name: 'Compare 2', exact: true }).click();
  const ready = page.getByRole('heading', { name: /^2 runs, baseline Synthetic k6 suite / });
  const failed = page.getByText('Comparison could not be loaded. Use Refresh comparison to retry.', { exact: true });
  // The service owns 30 s; allow the existing 5 s browser admission before expecting its outcome.
  await expect(ready.or(failed)).toBeVisible({ timeout: 35000 });
  if (await failed.isVisible()) {
    console.log(JSON.stringify({ format: 'beetle-browser-read-recovery', read: 'comparison', explicitRetry: true }));
    await page.getByRole('button', { name: 'Refresh comparison', exact: true }).click();
  }
  await expect(ready).toBeVisible({ timeout: 35000 });
  await expect(page.getByText('Loading comparison…', { exact: true })).toHaveCount(0);
  const exploration = page.locator('details.compare-advanced');
  await expect(exploration).toBeVisible();
  if (!(await exploration.evaluate((node) => node.hasAttribute('open'))))
    await exploration.getByText('Explore metrics and recorded evidence', { exact: true }).click();
  await expect(page.getByRole('heading', { name: `Baseline: ${ids[0]}`, exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: `Run 2: ${ids[1]}`, exact: true })).toBeVisible();
  const catalogue = page.getByRole('combobox', { name: /^Baseline metric\b/ });
  const retryCatalogue = page.getByRole('button', { name: 'Retry metric catalogue', exact: true });
  await catalogue.or(retryCatalogue).waitFor();
  if (await retryCatalogue.isVisible()) {
    console.log(
      JSON.stringify({ format: 'beetle-browser-read-recovery', read: 'comparison-catalogue', explicitRetry: true }),
    );
    await retryCatalogue.click();
  }
  await catalogue.selectOption({ index: 1 });
  await expect(page.getByText(/^Whole-run total:/)).toHaveCount(2);
}
/**
 * @param {import('@playwright/test').Page} page
 * @param {Awaited<ReturnType<import('./authoring.mjs').author>>} authored
 * @param {string} [evidence]
 */
export async function cancelReconnect(page, authored, evidence) {
  const config = structuredClone(authored.config);
  config.loadPlan.scenarios[0].iterations = 100;
  config.loadPlan.scenarios[0].maxDuration = '45s';
  config.selections[0].entries[0].wait = { durationMs: 500, jitterMs: 0 };
  await page.goto(authored.suite);
  await revision(page, config, 2);
  const submitted = await start(page);
  await currentWindow(page);
  await verifyPaused(page, evidence);
  await interruptLiveFeed(page, evidence);
  await page.reload();
  await currentWindow(page);
  await page.getByRole('button', { name: 'Cancel run', exact: true }).click();
  await expect(page.getByText('Cancelled', { exact: true }).first()).toBeVisible({ timeout: 60000 });
  await assertRunState(page, { state: 'cancelled', outcome: 'inconclusive' }, submitted);
}
/**
 * @param {import('@playwright/test').Page} page
 * @param {string | undefined} evidence
 */
async function verifyPaused(page, evidence) {
  await page.getByRole('button', { name: 'Pause stream', exact: true }).click();
  await expect(page.getByText(/stream paused at/)).toBeVisible();
  const resume = page.getByRole('button', { name: 'Resume stream', exact: true });
  await expect(resume).toBeVisible();
  if (evidence) await page.screenshot({ path: join(evidence, 'live-paused.png'), fullPage: true });
  await resume.click();
  await expect(page.getByRole('button', { name: 'Pause stream', exact: true })).toBeVisible();
}

/**
 * @param {import('@playwright/test').Page} page
 * @param {string | undefined} evidence
 */
async function interruptLiveFeed(page, evidence) {
  const path = new URL(page.url()).pathname;
  const state = page.getByRole('heading', { name: /^No word from the agent for / });
  const retry = page.getByRole('button', { name: 'Retry now', exact: true });
  const metrics = new RegExp(`^https?://[^/]+/api/v2${path}/attempts/[^/]+/metrics/live(?:\\?.*)?$`);
  let interrupted = 0;
  /** @param {import('@playwright/test').Route} route */
  const interrupt = (route) => {
    interrupted++;
    return route.abort('connectionreset');
  };
  await page.route(metrics, interrupt);
  try {
    await expect(state).toBeVisible({ timeout: 10000 });
    assert(interrupted > 0, 'Expected to observe an interrupted live metric read');
    await expect(retry).toBeEnabled();
    await currentWindow(page);
    if (evidence) await page.screenshot({ path: join(evidence, 'live-reconnecting.png'), fullPage: true });
  } finally {
    await page.unroute(metrics, interrupt);
  }
  const recovered = page.waitForResponse((response) => metrics.test(response.url()) && response.status() === 200, {
    timeout: 10000,
  });
  void recovered.catch(() => undefined);
  await retry.click();
  await recovered;
  await expect(state).toHaveCount(0, { timeout: 10000 });
  await currentWindow(page);
}

/**
 * @param {import('@playwright/test').Page} page
 * @param {string} run
 */
export async function deleteRun(page, run) {
  const key = runRoute(run);
  await page.goto(run);
  await page.getByRole('button', { name: 'Delete run…', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: `Delete run ${key.id.slice(0, 4)}?`, exact: true });
  await dialog.getByRole('button', { name: 'Delete this run…', exact: true }).click();
  const path = `/api/v2/organizations/${key.organizationId}/workspaces/${key.workspaceId}/runs/${key.id}/deletion-preview`;
  const response = page.waitForResponse(
    (reply) => new URL(reply.url()).pathname === path && reply.request().method() === 'POST',
  );
  void response.catch(() => undefined);
  await dialog.getByRole('button', { name: 'Preview this run deletion', exact: true }).click();
  const previewReply = await response;
  assert.equal(previewReply.status(), 200);
  const preview = validateApi('RetentionPreview', await previewReply.json());
  assert(preview.ok, 'Expected the real scoped deletion preview');
  assert.deepEqual(preview.value.scope, {
    kind: 'workspace',
    organizationId: key.organizationId,
    workspaceId: key.workspaceId,
  });
  assert.deepEqual(
    preview.value.candidates.map((candidate) => candidate.id),
    [key.id],
  );
  await dialog.getByRole('button', { name: `Delete run ${key.id.slice(0, 4)}`, exact: true }).click();
  // Native cleanup and transport backoff can outlast one 60-second browser wait.
  await expect(dialog.getByRole('heading', { name: 'Removed 1 run', exact: true })).toBeVisible({ timeout: 180000 });
  await dialog.getByRole('button', { name: 'Acknowledge completed batch', exact: true }).click();
  const missing = page.waitForResponse(
    (reply) =>
      new URL(reply.url()).pathname === path.replace('/deletion-preview', '') && reply.request().method() === 'GET',
  );
  void missing.catch(() => undefined);
  await page.reload();
  assert.equal((await missing).status(), 404);
  await expect(page.getByRole('heading', { name: "That run isn't here", exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Back to runs', exact: true })).toHaveAttribute(
    'href',
    `/organizations/${key.organizationId}/workspaces/${key.workspaceId}/runs`,
  );
}

/** Require an actual recorded figure, not merely the mounted loading view.
 * @param {import('@playwright/test').Page} page */
async function currentWindow(page) {
  const progress = page.getByRole('region', { name: 'Progress', exact: true });
  await expect(progress).toBeVisible({ timeout: 15000 });
  const first = progress.locator('dd').first();
  await expect(first).toBeVisible();
  await expect(first).not.toHaveText(/^[–—-]$/, { timeout: 15000 });
}

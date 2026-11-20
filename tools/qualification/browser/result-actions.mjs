import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect } from '@playwright/test';
import { runArtifactContentPath, validateApi } from '@beetle/contracts/api';
import { execute } from './results.mjs';
import { runScriptZip } from './exports.mjs';

/** @typedef {import('@playwright/test').Page} Page */
/** @typedef {Awaited<ReturnType<import('./authoring.mjs').author>>} Authored */

/** @param {Page} page @param {Authored} authored @param {string} evidence */
export async function resultActions(page, authored, evidence) {
  await page.setViewportSize({ width: 1440, height: 900 });
  const address = await execute(page);
  await page.getByRole('tab', { name: 'Diagnostics', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Native warnings', exact: true })).toContainText(
    'Diagnostic coverage:',
  );
  await page.getByRole('tab', { name: 'Report', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Verified performance report' })).toBeVisible();
  const run = await readRun(page, address);
  await expect(page.getByText('Reading recorded chart history…', { exact: true })).toHaveCount(0);
  await downloadResults(page, run, evidence);
  await pinToast(page, run.id, evidence);
  const note = await keepLatestNote(page, address, evidence);
  await page.goto(authored.workspace + '/runs');
  const search = page.getByRole('searchbox', { name: 'Search runs' });
  await search.fill(note);
  await search.press('Enter');
  const row = page.getByRole('row').filter({ has: page.locator(`a[href="${new URL(address).pathname}"]`) });
  await expect(row).toContainText(note);
  await expect(page.getByRole('heading', { name: 'No runs match these filters' })).toHaveCount(0);
  await capture(page, evidence, 'results-note-history');
  await page.goto(address);
  await runScriptZip(page, run, evidence);
}

/** @param {Page} page @param {string} address */
async function readRun(page, address) {
  const url = new URL(address);
  const response = await page.request.get(url.origin + '/api/v2' + url.pathname);
  assert.equal(response.status(), 200);
  const checked = validateApi('Run', await response.json());
  assert(checked.ok && url.pathname.endsWith('/' + checked.value.id));
  return checked.value;
}

/** @param {Page} page @param {string} id @param {string} evidence */
async function pinToast(page, id, evidence) {
  const receipt = page.waitForResponse((reply) => {
    const path = new URL(reply.url()).pathname;
    return reply.request().method() === 'POST' && path.endsWith('/runs/' + id + '/pin');
  });
  await page.getByRole('button', { name: 'Pin this run' }).click();
  const reply = await receipt;
  assert.equal(reply.status(), 200);
  const checked = validateApi('RunPinReceipt', await reply.json());
  assert(checked.ok && checked.value.pinned);
  await expect(page.locator('.toast-region')).toContainText(
    `Run ${id.slice(0, 4)} is pinned. Retention will not remove it.`,
  );
  await capture(page, evidence, 'result-pin-toast');
}

/** @param {Page} page @param {import('@beetle/contracts/api').Run} run @param {string} evidence */
async function downloadResults(page, run, evidence) {
  const runRoute = new URL(page.url());
  const endpoint = runRoute.origin + '/api/v2' + runRoute.pathname;
  const response = await page.request.get(`${endpoint}/attempts/${run.activeAttemptId}/artifacts?limit=100`);
  assert.equal(response.status(), 200);
  const listed = validateApi('RunArtifactPage', await response.json());
  assert(listed.ok && listed.value.availability === 'ready' && listed.value.nextCursor === null);
  await overlappingContent(page, run, listed.value.items, evidence);
  const trigger = page.getByRole('button', { name: 'Download', exact: true });
  const group = page.getByRole('group', { name: 'Run downloads' });
  await trigger.click();
  await expect(group.getByRole('link', { name: /^Report\b/ })).toBeVisible();
  await capture(page, evidence, 'result-download-menu');
  for (const [label, kind] of /** @type {const} */ ([
    ['Report', 'performance-report'],
    ['Summary', 'numeric-final'],
    ['Metrics', 'metrics-csv'],
  ])) {
    /** @type {import('@beetle/contracts').Artifact | undefined} */
    const artifact = listed.value.items.find((entry) => entry.kind === kind);
    assert(artifact && artifact.bytes > 0 && artifact.bytes < 262144);
    if (!(await group.isVisible())) await trigger.click();
    const download = group.getByRole('link', { name: new RegExp('^' + label + '\\b') });
    const params = {
      organizationId: run.scope.organizationId,
      workspaceId: run.scope.workspaceId,
      runId: run.id,
      attemptId: run.activeAttemptId,
      artifactId: artifact.artifactId,
    };
    await expect(download).toHaveAttribute('href', runArtifactContentPath(params));
    const [saved] = await Promise.all([page.waitForEvent('download'), download.click()]);
    const path = join(evidence, kind);
    const problem = await saved.failure();
    if (problem) {
      const diagnostic = await page.request.get(runRoute.origin + runArtifactContentPath(params));
      const status = diagnostic.status();
      await diagnostic.dispose();
      throw Error(`${kind} browser download failed: ${problem}. A separate diagnostic read returned ${status}.`);
    }
    await saved.saveAs(path);
    const bytes = await readFile(path);
    assert.equal(bytes.length, artifact.bytes);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), artifact.sha256);
  }
  if (!(await group.isVisible())) await trigger.click();
  await expect(group.getByRole('link', { name: /^Script for revision 1/ })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(group).toHaveCount(0);
  await expect(trigger).toBeFocused();
}

/** @param {Page} page @param {import('@beetle/contracts/api').Run} run
 * @param {import('@beetle/contracts').Artifact[]} items @param {string} evidence */
async function overlappingContent(page, run, items, evidence) {
  const sampled = items.filter((entry) => ['performance-report', 'numeric-final'].includes(entry.kind));
  assert.equal(sampled.length, 2);
  assert(sampled.every((item) => item.bytes > 0 && item.bytes < 262144));
  const paths = sampled.map(({ artifactId }) =>
    runArtifactContentPath({
      organizationId: run.scope.organizationId,
      workspaceId: run.scope.workspaceId,
      runId: run.id,
      attemptId: run.activeAttemptId,
      artifactId,
    }),
  );
  const overlap = await page.evaluate(async (urls) => {
    return await Promise.all(
      urls.map(async (url) => {
        const response = await globalThis.fetch(url, { cache: 'no-store' });
        if (response.status === 200)
          return { status: response.status, length: (await response.arrayBuffer()).byteLength };
        const error = await response.json();
        return { status: response.status, code: error.code };
      }),
    );
  }, paths);
  await writeFile(join(evidence, 'overlap-receipt.json'), JSON.stringify(overlap), { mode: 0o600 });
  assert.deepEqual(
    overlap,
    sampled.map(({ bytes }) => ({ status: 200, length: bytes })),
  );
}

/** @param {Page} page @param {string} address @param {string} evidence */
async function keepLatestNote(page, address, evidence) {
  const note = 'Synthetic cache warmup';
  await page.getByRole('button', { name: 'Add a note' }).click();
  await page.getByLabel('Run note').fill('Initial synthetic note');
  await page.getByRole('button', { name: 'Save note' }).click();
  await expect(page.getByText('Initial synthetic note', { exact: true })).toBeVisible();
  const other = await page.context().newPage();
  try {
    await other.goto(address);
    await page.getByRole('button', { name: 'Edit note' }).click();
    await page.getByLabel('Run note').fill('Stale synthetic draft');
    await other.getByRole('button', { name: 'Edit note' }).click();
    await other.getByLabel('Run note').fill(note);
    await other.getByRole('button', { name: 'Save note' }).click();
    await expect(other.getByText(note, { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Save note' }).click();
    await expect(page.getByText('Latest note: ' + note, { exact: true })).toBeVisible();
    await expect(page.getByLabel('Run note')).toHaveValue('Stale synthetic draft');
    await capture(page, evidence, 'result-note-conflict');
    await page.getByRole('button', { name: 'Use theirs', exact: true }).click();
    await expect(page.getByText(note, { exact: true })).toBeVisible();
  } finally {
    await other.close();
  }
  return note;
}

/** @param {Page} page @param {string} evidence @param {string} name */
function capture(page, evidence, name) {
  return page.screenshot({ path: join(evidence, name + '.png'), fullPage: true, animations: 'disabled' });
}

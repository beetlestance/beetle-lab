import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { chromium, expect } from '@playwright/test';
import { openBrowser } from './browser.mjs';
import { executeCold } from '../native-application/cold/execute.ts';
import { fixture } from '../native-application/compose/fixture.ts';

const output = process.env.BEETLE_BROWSER_EVIDENCE;
assert(output && isAbsolute(output), 'An absolute browser evidence directory is required');
const f = await fixture(process.argv.slice(2));
await executeCold({ f, output, inspectViewer: (origin, run, artifacts) => inspect(origin, run, artifacts, output) });

/**
 * @param {string} origin
 * @param {import('@beetle/contracts/api').Run} run
 * @param {readonly {artifactId: string; kind: string; bytes: number; sha256: string}[]} artifacts
 * @param {string} evidence
 */
async function inspect(origin, run, artifacts, evidence) {
  const browser = await openBrowser(chromium, origin, process.env.BEETLE_BROWSER_WS_ENDPOINT);
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
    page.setDefaultTimeout(10000);
    const { organizationId, workspaceId } = run.scope;
    const history = `/organizations/${organizationId}/workspaces/${workspaceId}/runs`;
    const result = `${history}/${run.id}`;
    await page.goto(origin + history);
    const results = page.getByRole('region', { name: 'Run history table', exact: true });
    await results.locator(`a[href="${result}"]`).click();
    await expect(page).toHaveURL(origin + result);
    await checkResult(page);

    const report = artifacts.find((item) => item.kind === 'performance-report');
    assert(report && report.bytes > 0 && report.bytes <= 262144);
    const download = page.waitForEvent('download', { timeout: 10000 });
    await page.getByRole('link', { name: 'Download report', exact: true }).click();
    const file = join(evidence, 'restored-performance-report.txt');
    await (await download).saveAs(file);
    const bytes = await readFile(file);
    assert.equal(bytes.length, report.bytes);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), report.sha256);

    await capture(page, evidence, 'darkroom', 'desktop');
    await page.getByRole('radio', { name: 'Scarab', exact: true }).click();
    await page.reload();
    await checkResult(page);
    await capture(page, evidence, 'scarab', 'desktop');
    await page.setViewportSize({ width: 390, height: 844 });
    await checkResult(page, false);
    await capture(page, evidence, 'scarab', 'phone');
    return { navigation: true, readOnly: true, reportBytes: bytes.length, reportSha256: report.sha256, captures: 3 };
  } finally {
    await browser.close();
  }
}

/** @param {import('@playwright/test').Page} page @param {boolean} desktop */
async function checkResult(page, desktop = true) {
  const banner = page.getByText(/^You are looking at a restored backup from /);
  await expect(banner).toBeVisible();
  await expect(page.getByText('Read-only history: changes are unavailable.', { exact: true })).toBeVisible();
  await expect(page.locator('.result-sentence')).not.toContainText(/over 0 seconds/);
  if (desktop) {
    await expect(page.getByText('Restored · read-only', { exact: true })).toBeVisible();
    await expect(page.getByRole('rowheader', { name: 'GET /work', exact: true })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Verified performance report', exact: true })).toBeVisible();
  }
  for (const name of [/^Run again/, /^Add a note/, /^(Pin( this run)?|Unpin( this run)?)$/, /^Delete run/]) {
    await expect(page.getByRole('button', { name, includeHidden: true })).toHaveCount(0);
  }
}

/** @param {import('@playwright/test').Page} page @param {string} evidence @param {string} skin @param {string} size */
async function capture(page, evidence, skin, size) {
  await expect(page.locator('html')).toHaveAttribute('data-theme', skin);
  assert(await page.evaluate(() => globalThis.document.documentElement.scrollWidth <= globalThis.innerWidth + 1));
  await page.evaluate(() => globalThis.scrollTo(0, 0));
  await page.screenshot({ path: join(evidence, `restored-history-${skin}-${size}.png`), fullPage: true });
}

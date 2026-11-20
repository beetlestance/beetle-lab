// Run result: the report tabs (what happened, artifacts, diagnostics) and the artifact viewer.
import { capture, settle, test, viewports } from '../../harness.js';
import type { Page } from '@playwright/test';
import { buildCase, installResult, resultPath } from '../../world/results/install.js';

async function open(page: Page, hash: string, c: ReturnType<typeof buildCase>) {
  await page.setViewportSize(viewports.desktop);
  await page.goto(resultPath(c.ids.run) + hash);
  await settle(page);
}

test('run-result-what-happened', async ({ page, api }) => {
  const c = buildCase({ variant: 'passed' });
  installResult(api, c);
  await open(page, '', c);
  await page.locator('#result-report').getByRole('tab', { name: 'What happened' }).click();
  await page.getByRole('heading', { name: 'What happened' }).waitFor();
  await page.waitForLoadState('networkidle');
  await page.mouse.click(2, 2);
  await page.evaluate(() => window.scrollTo(0, 0));
  await capture(page, 'run-result-what-happened-desktop');
});

test('run-result-artifacts', async ({ page, api }) => {
  const c = buildCase({ variant: 'passed' });
  installResult(api, c);
  await open(page, '#result-artifacts', c);
  await page.getByRole('table', { name: 'Artifact descriptors' }).waitFor();
  await capture(page, 'run-result-artifacts-desktop');
});

test('run-result-diagnostics', async ({ page, api }) => {
  const c = buildCase({ variant: 'passed' });
  installResult(api, c);
  await open(page, '#result-diagnostics', c);
  await page.getByRole('heading', { name: 'Native k6 warnings' }).waitFor();
  await capture(page, 'run-result-diagnostics-desktop');
});

test('run-result-diagnostics-log', async ({ page, api }) => {
  const c = buildCase({ variant: 'passed' });
  installResult(api, c);
  await open(page, '#result-diagnostics', c);
  await page.getByRole('button', { name: 'Open the sanitized log' }).click();
  await page.getByText(/Capture coverage: complete/).waitFor();
  await capture(page, 'run-result-diagnostics-log-desktop', { viewportOnly: true });
});

test('run-result-artifact-viewer', async ({ page, api }) => {
  const c = buildCase({ variant: 'passed' });
  installResult(api, c);
  await open(page, '#result-artifacts', c);
  await page.getByRole('button', { name: 'Verify and open performance-report.txt' }).click();
  await page.getByText(/Size and SHA-256 match/).waitFor();
  await capture(page, 'run-result-artifact-viewer-desktop', { viewportOnly: true });
});

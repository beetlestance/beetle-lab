// Upload input dialog through its states. The fake backend in world/inputs.ts answers createInput,
// the chunk PUTs and sealInput; a held request freezes the dialog mid-step.
import type { Page } from '@playwright/test';
import { capture, expect, test, viewports } from '../../harness.js';
import { base, uploadBackend } from '../../world/inputs.js';
import type { UploadScript } from '../../world/inputs.js';

const kb = 1024;
const file = (bytes: number, name = 'orders.csv') => ({
  name,
  mimeType: name.endsWith('.csv') ? 'text/csv' : 'application/json',
  buffer: Buffer.alloc(bytes, 'id,sku,qty\n'),
});

async function openDialog(page: Page, size: keyof typeof viewports = 'desktop') {
  await page.setViewportSize(viewports[size]);
  await page.goto(`${base}/inputs`);
  await page.getByRole('button', { name: 'Upload files' }).first().click();
  await expect(page.getByRole('dialog', { name: 'Upload input' })).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
}

async function choose(page: Page, bytes: number, name?: string) {
  await page.setInputFiles('#upload-file', file(bytes, name));
  await expect(page.locator('#upload-name')).not.toHaveValue('');
}

async function submit(page: Page) {
  await page.getByRole('dialog').getByRole('button', { name: 'Upload input' }).click();
}

async function run(page: Page, api: Parameters<typeof uploadBackend>[0], script: UploadScript, bytes: number) {
  uploadBackend(api, script);
  await openDialog(page);
  await choose(page, bytes);
  await submit(page);
}

const heldMid: UploadScript = { holdChunk: 8 };
const midText = /Last confirmed: staging, 458752 \/ 1000000 bytes/;

test('upload input: empty form', async ({ page, api }) => {
  uploadBackend(api);
  await openDialog(page);
  await capture(page, 'upload-input-desktop', { viewportOnly: true });
});

test('upload input: file chosen, ready to send', async ({ page, api }) => {
  uploadBackend(api);
  await openDialog(page);
  await choose(page, 200 * kb);
  await capture(page, 'upload-input-chosen-desktop', { viewportOnly: true });
});

test('upload input: checking (create request in flight)', async ({ page, api }) => {
  await run(page, api, { holdCreate: true }, 200 * kb);
  await expect(page.getByRole('status').filter({ hasText: 'Working…' })).toBeVisible();
  await capture(page, 'upload-input-checking-desktop', { viewportOnly: true });
});

test('upload input: uploading', async ({ page, api }) => {
  await run(page, api, heldMid, 1_000_000);
  await expect(page.getByText(midText)).toBeVisible();
  await capture(page, 'upload-input-uploading-desktop', { viewportOnly: true });
});

test('upload input: phone, uploading', async ({ page, api }) => {
  uploadBackend(api, heldMid);
  await openDialog(page, 'phone');
  await choose(page, 1_000_000, 'orders-large.json');
  await submit(page);
  await expect(page.getByText(midText)).toBeVisible();
  await capture(page, 'phone-upload-input-phone', { viewportOnly: true });
});

test('upload input: interrupted by Cancel upload', async ({ page, api }) => {
  await run(page, api, heldMid, 1_000_000);
  await expect(page.getByText(midText)).toBeVisible();
  await page.getByRole('button', { name: 'Cancel upload' }).click();
  await expect(page.getByRole('button', { name: 'Refresh upload status' })).toBeVisible();
  await capture(page, 'upload-input-interrupted-desktop', { viewportOnly: true });
});

test('upload input: publishing', async ({ page, api }) => {
  await run(page, api, { sealed: { state: 'publishing' } }, 200 * kb);
  await expect(page.getByText(/Publication is pending/)).toBeVisible();
  await capture(page, 'upload-input-publishing-desktop', { viewportOnly: true });
});

test('upload input: published', async ({ page, api }) => {
  const sealed = { state: 'published', publishedAt: '2026-11-07T23:39:30.000Z', rowCount: 48210, columnCount: 6 };
  await run(page, api, { sealed }, 200 * kb);
  await expect(page.getByText(/Upload complete/)).toBeVisible();
  await capture(page, 'upload-input-published-desktop', { viewportOnly: true });
});

test('upload input: failed', async ({ page, api }) => {
  await run(page, api, { sealed: { state: 'failed', reason: 'integrity' } }, 200 * kb);
  await expect(page.getByText(/backend reports failed/)).toBeVisible();
  await capture(page, 'upload-input-failed-desktop', { viewportOnly: true });
});

test('upload input: too large', async ({ page, api }) => {
  uploadBackend(api);
  await openDialog(page);
  await choose(page, 8 * 1024 * 1024 + 1, 'orders-full.csv');
  await expect(page.getByRole('alert')).toContainText('no larger than 8 MiB');
  await capture(page, 'upload-input-too-large-desktop', { viewportOnly: true });
});

// Shared helpers for the live run specs (not itself a spec file).
import type { Page } from '@playwright/test';
import { expect } from '../../harness.js';
import { ids } from '../../world/index.js';
import { liveIds } from '../../world/runs/live.js';

export const livePath = `/organizations/${ids.organization}/workspaces/${ids.workspace}/runs/${liveIds.run}`;

/** The first frame has drawn: figures, the endpoint table and the recorded history are on screen. */
export async function figuresReady(page: Page): Promise<void> {
  await expect(page.getByText('Where the requests go')).toBeVisible();
  await expect(page.getByText('p95 latency, whole run')).toBeVisible();
  await expect(page.getByText(/History coverage/)).toBeVisible();
  await page.waitForLoadState('networkidle');
}

/** An early-phase page: heading and the step list are drawn. */
export async function earlyReady(page: Page): Promise<void> {
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Cancel run' })).toBeVisible();
  await page.waitForLoadState('networkidle');
}

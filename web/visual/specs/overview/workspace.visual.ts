// CASES.md section 2: the workspace dashboard (overview, idle, empty, loading, error, search).
import type { Page } from '@playwright/test';
import { capture, expect, settle, shoot, test, viewports } from '../../harness.js';
import { ids } from '../../world/index.js';
import {
  measuredStatus,
  olderRun,
  runSpecs,
  serverError,
  workspaceOverview,
  workspaceUrl,
  workspaceWorld,
} from '../../world/overview/index.js';
import type { Api } from '../../harness.js';

/** The populated dashboard has finished loading: live card, recent p95 labels and agent gauges. */
async function overviewReady(page: Page): Promise<void> {
  await expect(page.getByText('requests a second')).toBeVisible();
  await expect(page.getByText('241 ms')).toBeVisible();
  await expect(page.getByText(/of 8 CPUs/)).toBeVisible();
}

async function idleReady(page: Page): Promise<void> {
  await expect(page.getByRole('heading', { name: 'No runs in progress' })).toBeVisible();
  await expect(page.getByText('241 ms')).toBeVisible();
  await expect(page.getByText(/of 8 CPUs/)).toBeVisible();
}

test('overview: populated, one run active', async ({ page, api }) => {
  workspaceWorld(api);
  await shoot(page, workspaceUrl, 'overview', {
    viewports: ['desktop', 'phone', 'tablet', 'ultrawide'],
    ready: async (p) => {
      await overviewReady(p);
      if (p.viewportSize()?.width === viewports.phone.width) {
        const phase = p.locator('.overview-live .live-stage.is-now');
        const clear = await phase.evaluate((element) => {
          const label = element.querySelector('.live-stage-label')!.getBoundingClientRect();
          const track = element.querySelector<HTMLElement>('.live-stage-track > span')!;
          const marker = getComputedStyle(track, '::after');
          const outerRadius = Number.parseFloat(marker.height) / 2 + 2;
          const trackBounds = track.getBoundingClientRect();
          return trackBounds.top + trackBounds.height / 2 - outerRadius >= label.bottom;
        });
        expect(clear).toBe(true);
      }
      await settle(p, async () => {});
    },
  });
});

test('overview-idle: nothing running', async ({ page, api }) => {
  workspaceWorld(api, { recent: [...runSpecs.slice(1), olderRun], hidden: [] });
  await shoot(page, workspaceUrl, 'overview-idle', { ready: idleReady });
});

test('overview-empty: new workspace', async ({ page, api }) => {
  workspaceWorld(api);
  api.on('getWorkspaceOverview', workspaceOverview({ recent: [], hidden: [], older: 0, suites: 0 }));
  await shoot(page, workspaceUrl, 'overview-empty', {
    viewports: ['desktop', 'phone'],
    ready: async (p) => {
      await expect(p.getByRole('heading', { name: 'No runs in Checkout yet' })).toBeVisible();
      await expect(p.getByText(/The agent is ready/)).toBeVisible();
    },
  });
});

test('overview-loading: overview read pending', async ({ page, api }) => {
  workspaceWorld(api);
  api.on('getWorkspaceOverview', 'pending');
  await shoot(page, workspaceUrl, 'overview-loading', {
    ready: async (p) => {
      await expect(p.locator('.overview-loading')).toBeVisible();
    },
  });
});

test('overview-error: overview read fails', async ({ page, api }) => {
  workspaceWorld(api);
  api.on('getWorkspaceOverview', serverError());
  await shoot(page, workspaceUrl, 'overview-error', {
    ready: async (p) => {
      await expect(p.getByText('Workspace overview unavailable. Counts are unknown.')).toBeVisible();
    },
  });
});

async function openSearch(page: Page, api: Api, query: string): Promise<void> {
  workspaceWorld(api);
  await page.setViewportSize(viewports.desktop);
  await page.goto(workspaceUrl);
  await settle(page, overviewReady);
  await page.keyboard.press('ControlOrMeta+k');
  await page.getByRole('searchbox', { name: 'Search commands and recent items' }).fill(query);
  await expect(page.getByRole('dialog', { name: 'Search commands' })).toBeVisible();
}

test('overview-search: query typed in the search overlay over the overview', async ({ page, api }) => {
  await openSearch(page, api, 'steady');
  await expect(page.getByText('Start steady-1.2k')).toBeVisible();
  await expect(page.getByText('Run a7f2, steady-1.2k')).toBeVisible();
  await capture(page, 'overview-search-desktop', { viewportOnly: true });
});

test('unavailable-note: agent gauges with host use not measured', async ({ page, api }) => {
  // The contract fixture's host reports CPU use and free memory as "not measured".
  const status = {
    ...measuredStatus(),
    host: {
      ...(measuredStatus().host as object),
      cpuUsedMillis: { status: 'not_measured', value: null },
      memoryAvailableBytes: { status: 'not_measured', value: null },
    },
  };
  workspaceWorld(api, { status });
  await shoot(page, `/organizations/${ids.organization}/workspaces/${ids.workspace}`, 'unavailable-note', {
    ready: async (p) => {
      await expect(p.getByText('8 CPUs, use not measured')).toBeVisible();
      await expect(p.getByText('241 ms')).toBeVisible();
    },
  });
});

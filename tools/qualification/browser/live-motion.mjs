import assert from 'node:assert/strict';
import { join } from 'node:path';
import { writeFile } from 'node:fs/promises';
import { expect } from '@playwright/test';
import { stagedConfiguration } from './live-staged.mjs';
import { revision } from './authoring.mjs';
import { start } from './results.mjs';
import { assertRunState } from './run-state.mjs';
import { targetCounts } from '../native-application/target-runtime/target.ts';

/** @typedef {import('@playwright/test').Page} Page */
/** @typedef {import('@playwright/test').Locator} Locator */
const activeFill = '.live-stage.is-now .live-stage-track > span';

/**
 * @param {Page} page
 * @param {Awaited<ReturnType<import('./authoring.mjs').author>>} authored
 * @param {import('../native-application/compose/fixture.ts').Fixture} fixture
 * @param {string} evidence
 */
export async function liveMotion(page, authored, fixture, evidence) {
  await page.setViewportSize({ width: 1440, height: 2584 });
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto(authored.suite);
  await revision(page, stagedConfiguration(), 2);
  const run = await start(page);
  const stage = page.locator('.live-stage.is-now');
  const chart = page.locator('.live-whole .live-line').first();
  await expect(stage).toContainText('Steady', { timeout: 26000 });
  await expect(page.locator('.live-endpoints tbody tr')).toHaveCount(5);
  await expect(page.locator('.live-threshold.is-holding')).toHaveCount(3);
  await expect(chart).toBeVisible();
  const fill = page.locator(activeFill);
  const duration = await widthDurationSeconds(fill);
  assert(duration >= 0.05);
  await expect
    .poll(
      () =>
        fill.evaluate((node) =>
          node
            .getAnimations()
            .some(
              (animation) => animation instanceof globalThis.CSSTransition && animation.transitionProperty === 'width',
            ),
        ),
      { timeout: 4500, intervals: [80] },
    )
    .toBe(true);
  const frames = await captureSequence(page, evidence);
  const last = frames.at(-1);
  assert(last);
  const reduced = await captureReduced(page, evidence, last.progress);
  const result = page.locator('.result-head').getByText('Passed', { exact: true });
  const open = page.getByRole('button', { name: 'Open result', exact: true });
  await expect(open.or(result)).toBeVisible({ timeout: 60000 });
  if (await open.isVisible()) await open.click();
  await expect(result).toBeVisible();
  await assertRunState(page, { state: 'finished', outcome: 'passed' }, run);
  const observed = targetCounts(fixture);
  assert(observed.ready === 1 && observed.work >= 90 && observed.work <= 180);
  assert.equal(observed.unexpected, 0);
  await writeFile(
    join(evidence, 'live-motion-coverage.json'),
    JSON.stringify({ frames, transitionSeconds: duration, reduced, observed }),
    { mode: 0o600, flag: 'wx' },
  );
}

/** @param {Page} page @param {string} evidence */
async function captureSequence(page, evidence) {
  const progress = page.locator('.live-percent');
  const chart = page.locator('.live-whole .live-line').first();
  const stage = page.locator('.live-stage.is-now');
  const frames = [];
  const paths = new Set();
  let last = 39;
  let lastFill = 0;
  for (let index = 1; index <= 8; index++) {
    last = await nextProgress(progress, last);
    await expect(stage).toContainText('Steady');
    const path = await chart.getAttribute('d');
    assert(path);
    paths.add(path);
    const fill = await page
      .locator(activeFill)
      .evaluate((node) => Number.parseFloat(/** @type {HTMLElement} */ (node).style.width));
    assert(fill >= lastFill);
    lastFill = fill;
    frames.push({ index, progress: last, fill, kpis: await page.locator('.live-kpis dd').allTextContents() });
    await page.screenshot({
      path: join(evidence, `live-motion-${String(index).padStart(2, '0')}.png`),
      fullPage: true,
    });
  }
  assert(paths.size >= 2, 'Recorded chart path changed across real windows');
  return frames;
}

/** @param {Page} page @param {string} evidence @param {number} previous */
async function captureReduced(page, evidence, previous) {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const track = page.locator(activeFill);
  const duration = await widthDurationSeconds(track);
  assert(duration <= 0.0001);
  const progress = await nextProgress(page.locator('.live-percent'), previous);
  assert.equal(await page.evaluate(() => globalThis.matchMedia('(prefers-reduced-motion: reduce)').matches), true);
  await expect(page.locator('.live-whole .live-line').first()).toBeVisible();
  await page.screenshot({ path: join(evidence, 'live-motion-reduced.png'), fullPage: true });
  return { progress, transitionSeconds: duration };
}

/** @param {Locator} progress @param {number} previous */
async function nextProgress(progress, previous) {
  const read = async () => Number.parseInt((await progress.textContent()) ?? '', 10);
  await expect.poll(read, { timeout: 16000, intervals: [100] }).toBeGreaterThan(previous);
  return read();
}

/** @param {Locator} track */
function widthDurationSeconds(track) {
  return track.evaluate((node) => {
    const duration = globalThis.getComputedStyle(node).transitionDuration;
    return Number.parseFloat(duration) / (duration.endsWith('ms') ? 1000 : 1);
  });
}

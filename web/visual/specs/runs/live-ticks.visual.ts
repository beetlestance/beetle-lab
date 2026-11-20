// Successive live polls. The app polls the agent on real timers every 2 s, but reads the
// wall clock through Date, which the harness fixes. Each tick therefore moves the agent
// clock (what the fixture replies with) and the page clock (setFixedTime) together, then
// waits for the next poll to be answered and drawn before the screenshot.
import { NOW, capture, expect, settle, test, viewports } from '../../harness.js';
import { signedIn } from '../../world/index.js';
import { agent, elapsedAtNow, installLive, tickSeconds } from '../../world/runs/live.js';
import { figuresReady, livePath } from './live-shared.js';

const clock = (seconds: number) =>
  `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;

test('live-run-ticks', async ({ page, api }) => {
  test.setTimeout(120_000);
  agent.elapsed = elapsedAtNow;
  signedIn(api);
  installLive(api);
  await page.setViewportSize(viewports.desktop);
  await page.goto(livePath);
  await settle(page, figuresReady);
  const polls = () => api.calls.filter((call) => call.operation === 'getRunLiveMetrics').length;
  for (let tick = 0; tick < 8; tick++) {
    const seconds = elapsedAtNow + tick * tickSeconds;
    if (tick > 0) {
      agent.elapsed = seconds;
      await page.clock.setFixedTime(new Date(Date.parse(NOW) + tick * tickSeconds * 1000));
      const before = polls();
      await expect.poll(polls, { timeout: 15_000 }).toBeGreaterThan(before);
    }
    await expect(page.getByText(`${clock(seconds)} elapsed`)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(`now ${clock(seconds)}`)).toBeVisible();
    await page.waitForLoadState('networkidle');
    await capture(page, `live-run-ticks-0${tick + 1}-desktop`);
  }
});

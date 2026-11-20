import { clearTimeout, setTimeout } from 'node:timers';
import { validateApi } from '@beetle/contracts/api';
import { checkRunState } from './run-state.mjs';

/**
 * Let the real event read catch up before displaying the already-fetched terminal response.
 * Only the switch from a delivered finalizing response is held. No state is replaced.
 * @param {import('@playwright/test').Page} page
 * @param {import('./run-state.mjs').SubmittedRun} run
 */
export async function holdTerminalRead(page, run) {
  const address = run.origin + '/api/v2' + run.path;
  /** @type {() => void} */ let resolve = () => {};
  /** @type {Promise<void>} */ const promise = new Promise((done) => {
    resolve = done;
  });
  let sawFinalizing = false;
  let held = false;
  /** @type {ReturnType<typeof setTimeout> | undefined} */ let expiry;
  /** @param {import('@playwright/test').Route} route */
  const receive = async (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    const response = await route.fetch({ maxRedirects: 0 });
    if (response.ok()) {
      const body = await response.json();
      const checked = validateApi('Run', body);
      if (checked.ok && checked.value.state === 'finalizing') {
        checkRunState(body, run, { state: 'finalizing', outcome: checked.value.outcome }, run);
        sawFinalizing = true;
      } else if (sawFinalizing && !held && checked.ok && checked.value.state === 'cancelled') {
        checkRunState(body, run, { state: 'cancelled', outcome: 'inconclusive' }, run);
        held = true;
        expiry = setTimeout(resolve, 4800);
        await promise;
        clearTimeout(expiry);
      }
    }
    await route.fulfill({ response });
  };
  await page.route(address, receive);
  return {
    async release() {
      clearTimeout(expiry);
      resolve();
      await page.unroute(address, receive);
    },
    held: () => held,
  };
}

/**
 * Record the actual browser timeline reads during this transition.
 * @param {import('@playwright/test').Page} page
 * @param {import('./run-state.mjs').SubmittedRun} run
 */
export function watchSealingReads(page, run) {
  const address = run.origin + '/api/v2' + run.path + '/events';
  /** @type {ReturnType<typeof evidenceFromRead>[]} */ const reads = [];
  /** @param {import('@playwright/test').Response} response */
  const receive = (response) => {
    if (!response.url().startsWith(address + '?') || reads.length >= 16) return;
    reads.push(evidenceFromRead(response));
  };
  page.on('response', receive);
  return () => {
    page.off('response', receive);
    return Promise.all(reads);
  };
}

/** @param {import('@playwright/test').Response} response */
async function evidenceFromRead(response) {
  const status = response.status();
  try {
    const body = await response.json();
    if (!response.ok()) return { status, code: String(body?.code ?? 'unknown').slice(0, 80) };
    const checked = validateApi('RunEventPage', body);
    if (!checked.ok) return { status, invalid: true };
    return {
      status,
      coverage: checked.value.coverage,
      through: checked.value.durableThrough,
      hasCollection: checked.value.items.some((item) => item.kind === 'phase.started' && item.phase === 'collect'),
    };
  } catch {
    return { status, unreadable: true };
  }
}

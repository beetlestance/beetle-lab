import { writeFile, readFile, mkdir } from 'node:fs/promises';
import { join, isAbsolute } from 'node:path';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { counts } from '../resources/lifecycle/observations.ts';
import { chromium } from '@playwright/test';
import { openBrowser } from './browser.mjs';
import { fixture } from '../native-application/compose/fixture.ts';
import { cleanup } from '../native-application/compose/evidence.ts';
import { automaticClient } from '../native-application/compose/public.ts';
import { author, revision } from './authoring.mjs';
import { execute, results } from './results.mjs';
import { inputs, settings, emptyFolder, directoryImport } from './inputs-settings.mjs';
import { offlineExport } from './exports.mjs';
import { historyComparison, cancelReconnect, deleteRun } from './lifecycle.mjs';
import { cleanupBrowserInstallation } from './cleanup.mjs';
import { keyboard, themesAndViewports } from './interactions.mjs';
import { crossScope } from './scope.mjs';
import { reference } from './reference.mjs';
import { targetRuntime } from './target-runtime.mjs';
import { configuration as targetConfiguration } from '../native-application/target-runtime/config.ts';
import { target as configureTarget, targetCounts } from '../native-application/target-runtime/target.ts';
const profile = process.env.BEETLE_BROWSER_PROFILE ?? 'functional';
if (!['functional', 'interaction', 'reference', 'target-runtime'].includes(profile))
  throw Error('Unsupported browser profile');
const evidence = process.env.BEETLE_BROWSER_EVIDENCE;
if (profile !== 'functional' && !evidence) throw Error('Selected profile requires an explicit evidence directory');
if (evidence) {
  if (!isAbsolute(evidence)) throw Error('Absolute evidence directory required');
  await mkdir(evidence, { mode: 0o700 });
}
/** Same six explicit source images and owned Compose fixture as native acceptance. */
const f = await fixture(process.argv.slice(2));
if (evidence)
  await writeFile(
    join(evidence, 'owner.json'),
    JSON.stringify({ root: f.root, project: f.project, revision: f.revision, owner: randomUUID() }),
    { flag: 'wx', mode: 0o600 },
  );
const outcome = {
  format: 'beetle-browser-outcome',
  version: 1,
  status: 'failed',
  revision: f.revision,
  profile,
  architecture: f.architecture,
  imageIds: f.imageIds,
  phase: 'startup',
  completed: /** @type {string[]} */ ([]),
  cleanupVerified: false,
};
/** @type {import('@playwright/test').Browser | undefined} */ let browser;
/** @type {import('@playwright/test').Page | undefined} */ let page;
/** @type {string | undefined} */ let installation;
/** @template T @param {string} name @param {() => Promise<T>} run */
async function phase(name, run) {
  outcome.phase = name;
  const value = await run();
  outcome.completed.push(name);
  console.log(JSON.stringify({ format: 'beetle-browser-phase', phase: name, status: 'passed' }));
  return value;
}
try {
  // The browser sequence runs three small tests; retain a finite synthetic target request budget.
  const target = join(f.root, 'target.json');
  const override = JSON.parse(await readFile(target, 'utf8'));
  const entry = override.services['synthetic-target'].entrypoint;
  if (!entry[2].includes('if(++counts[key]>4)')) throw Error('Unexpected target fixture');
  entry[2] = entry[2].replace('if(++counts[key]>4)', 'if(++counts[key]>128)');
  await writeFile(target, JSON.stringify(override), { mode: 0o600 });
  if (profile === 'target-runtime') await configureTarget(f);
  f.compose('up', '-d', '--no-build');
  installation = (await automaticClient(f.origin)).installation.id;
  if (evidence)
    await writeFile(
      join(evidence, 'installation-owner.json'),
      JSON.stringify({ project: f.project, installationId: installation }),
      { flag: 'wx', mode: 0o600 },
    );
  browser = await openBrowser(chromium, f.origin, process.env.BEETLE_BROWSER_WS_ENDPOINT);
  const context = await browser.newContext({ acceptDownloads: true });
  const appPage = await context.newPage();
  page = appPage;
  appPage.setDefaultTimeout(15000);
  /** @type {number[]} */ const contentStatuses = [];
  let contentOverflow = false;
  if (profile === 'target-runtime')
    appPage.on('response', (response) => {
      const url = new URL(response.url());
      if (url.origin !== f.origin || !url.pathname.startsWith('/api/v2/') || !url.pathname.endsWith('/content')) return;
      if (contentStatuses.length >= 64) {
        contentOverflow = true;
        return;
      }
      contentStatuses.push(response.status());
    });
  const authored = await phase('automatic-access-and-authoring', () => author(appPage, f.origin));
  if (profile === 'interaction') {
    await phase('keyboard-navigation', () => keyboard(appPage, f.origin));
    await phase('themes-viewports-reduced-motion', () => themesAndViewports(appPage, authored.workspace));
    await phase('cross-scope-cache-and-refusal', () => crossScope(appPage, authored));
    await phase('no-performance-work', async () => {
      assert.deepEqual(counts(f), { ready: 0, work: 0, unexpected: 0 });
    });
  } else if (profile === 'reference') {
    const resources = await phase('reference-and-downloads', () => reference(appPage, f));
    if (evidence)
      await writeFile(join(evidence, 'reference-outcome.json'), JSON.stringify(resources), { flag: 'wx', mode: 0o600 });
    await phase('no-performance-work', async () => {
      assert.deepEqual(counts(f), { ready: 0, work: 0, unexpected: 0 });
    });
  } else if (profile === 'target-runtime') {
    await phase('target-suite-revision', () => revision(appPage, targetConfiguration(), 2));
    await phase('target-run-execution', () => execute(appPage));
    const observed = targetCounts(f);
    assert.equal(observed.ready, 1);
    assert.equal(observed.work, 40);
    assert.equal(observed.unexpected, 0);
    assert(Number.isSafeInteger(observed.runtime) && observed.runtime >= 6 && observed.runtime <= 32);
    const result = await phase('target-observation-view', () => targetRuntime(appPage, observed.runtime));
    assert.deepEqual(targetCounts(f), observed);
    assert(!contentOverflow);
    Object.assign(result, { contentStatuses });
    if (evidence)
      await writeFile(join(evidence, 'target-view-outcome.json'), JSON.stringify(result), { flag: 'wx', mode: 0o600 });
  } else {
    const run = await phase('run-execution', () => execute(appPage));
    await phase('report-metrics-and-download', () => results(appPage, f.root));
    await phase('history-comparison', () => historyComparison(appPage, authored, run));
    await phase('input-roundtrip', () => inputs(appPage, authored.workspace, f.root));
    await phase('directory-import', () => directoryImport(appPage, authored.workspace, f.root));
    await phase('empty-folder-deletion', () => emptyFolder(appPage, authored.workspace));
    await phase('settings-persistence', () => settings(appPage));
    await phase('offline-export', () => offlineExport(appPage, authored.suite, f.root));
    await phase('durable-run-reconnect', async () => {
      await appPage.goto(run);
      await results(appPage, f.root);
    });
    await phase('active-metrics-reconnect-cancellation', () => cancelReconnect(appPage, authored));
    await phase('run-deletion', () => deleteRun(appPage, run));
  }
  outcome.status = 'passed';
} catch (error) {
  process.exitCode = 1;
  await writeFile(join(f.root, 'browser-error.txt'), String(error).slice(0, 16384), { mode: 0o600 });
  if (page && !page.isClosed()) {
    await writeFile(join(f.root, 'browser-body.txt'), (await page.locator('body').innerText()).slice(0, 65536), {
      mode: 0o600,
    });
    await writeFile(
      join(f.root, 'browser-accessibility.txt'),
      (await page.locator('body').ariaSnapshot()).slice(0, 65536),
      { mode: 0o600 },
    );
  }
} finally {
  const closed = await cleanupBrowserInstallation(
    async () => {
      await browser?.close();
    },
    () => cleanup(f, installation),
  );
  outcome.cleanupVerified = closed.cleanupVerified;
  if (!closed.browserClosed || !closed.cleanupVerified) {
    outcome.status = 'failed';
    process.exitCode = 1;
  }
  await writeFile(join(f.root, 'browser-outcome.json'), JSON.stringify(outcome, null, 2), { mode: 0o600 });
  if (evidence)
    await writeFile(join(evidence, 'browser-outcome.json'), JSON.stringify(outcome), { flag: 'wx', mode: 0o600 });
  console.log(JSON.stringify({ ...outcome, root: f.root }));
}

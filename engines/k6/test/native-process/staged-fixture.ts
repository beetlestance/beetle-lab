import { chmod, mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { SuiteConfig } from '../../compiler/suite/index.js';
import { fixture, syntheticInstalledIdentity } from '../staged-input/fixtures.js';

/** Private synthetic installation layout; no credentials or image capability claim. */
export async function stagedFixture(target: string, timeoutMs = 15_000) {
  const base = await fixture();
  base.offer.inputs = []; base.offer.secretReferences = [];
  base.staging.inputFiles = []; base.staging.secretNames = [];
  base.staging.deadlineMs = Date.now() + timeoutMs;
  base.offer.budget.timeoutMs = timeoutMs; base.offer.budget.outputBytes = 8_388_608;
  base.manifest.engineVersion = '2.2.0';
  base.manifest.defaultBudget = { ...base.offer.budget };
  base.manifest.minimumBudget.outputBytes = 1;
  base.manifest.minimumBudget.timeoutMs = 1;
  for (const phase of base.manifest.phases) { phase.outputBytes = 4_194_304; phase.timeoutMs = 5000; }
  const config = base.offer.config as SuiteConfig;
  config.target = target; config.datasets = []; config.secrets = [];
  config.requests = [{ id: 'get', name: 'owned', method: 'GET', path: '/work', query: {}, headers: {},
    assertions: [{ id: 'ok', kind: 'statusEq', required: true, value: 200 }] }];
  config.selections[0]!.entries[0]!.maxIterationsPerVu = 1;
  config.readiness = { path: '/ready', attempts: 1, intervalMs: 0, timeoutMs: 1000, wallBudgetMs: 1000,
    expectedStatus: 200, assertions: [] };
  await rm(join(base.options.inputRoot, 'input-000.bin'));
  await rm(join(base.options.secretRoot, '_TOKEN'));
  base.offer.installedIdentity = syntheticInstalledIdentity(base.manifest);
  await base.save();
  for (const root of [base.options.inputRoot, base.options.secretRoot]) {
    for (const name of await readdir(root)) await chmod(join(root, name), 0o400);
    await chmod(root, 0o500);
  }
  const outputRoot = join(base.root, 'output'); await mkdir(outputRoot, { mode: 0o700 });
  const emptyConfig = join(base.root, 'empty.json'); await writeFile(emptyConfig, '{}\n', { flag: 'wx', mode: 0o600 });
  return { ...base, outputRoot, emptyConfig, options: { inputRoot: base.options.inputRoot,
    secretRoot: base.options.secretRoot, outputRoot, uid: base.options.uid, signal: base.controller.signal,
    installed: { ...base.options.installed, version: '2.2.0' } } };
}

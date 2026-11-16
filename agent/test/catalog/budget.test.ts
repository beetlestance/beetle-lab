import { expect, it } from 'vitest';
import { join } from 'node:path';
import { createEngineCatalog } from '../../src/catalog/index.js';
import { prepareRuntime, runtimeName } from '../../src/backends/docker/index.js';
import { offer, registration } from './fixtures.js';

const fields = ['cpuMillis', 'memoryBytes', 'pids', 'timeoutMs', 'outputBytes'] as const;
it.each(fields)('preserves positive below-minimum %s while actual runtime preparation remains strict', field => {
  const installed = registration(); const catalog = createEngineCatalog([installed]);
  for (const value of [1, installed.manifest.minimumBudget[field] - 1]) {
    const source = offer(installed); source.budget[field] = value;
    const original = structuredClone(source); const found = catalog.preflight(source);
    expect(found.offer).toEqual(original); expect(source).toEqual(original);
    expect(found.offer.budget[field]).toBe(value);
    expect(catalog.resolve(found.offer, found.validation)).toBe(found.engine);
    const name = runtimeName({ installationId: installed.profile.installationId, ...source, generation: 1 });
    const root = join(installed.profile.stagingRoot, name);
    expect(prepareRuntime({ offer: source, ...installed, generation: 1,
      staged: { input: join(root, 'input'), output: join(root, 'output'), secrets: join(root, 'secrets') } }).ok).toBe(false);
  }
  const equal = offer(installed); equal.budget = { ...installed.manifest.minimumBudget };
  expect(catalog.preflight(equal).offer).toEqual(equal);
});

it.each(fields)('keeps above-profile-maximum %s strict even with a different budget below minimum', field => {
  const installed = registration(); const catalog = createEngineCatalog([installed]);
  const source = offer(installed); source.budget[field] = installed.profile.maximumBudget[field] + 1;
  expect(() => catalog.preflight(source)).toThrow(expect.objectContaining({ reason: 'unapproved_engine' }));
  const other = fields.find(key => key !== field)!; source.budget[other] = 1;
  expect(() => catalog.preflight(source)).toThrow(expect.objectContaining({ reason: 'unapproved_engine' }));
});

it('preserves budgets larger than minima rather than probing only the manifest minimum', () => {
  const original = registration();
  const installed = { ...original, profile: { ...original.profile, maximumBudget: { ...original.profile.maximumBudget, pids: 256 } } };
  const catalog = createEngineCatalog([installed]); const source = offer(installed);
  source.budget.cpuMillis = 999; source.budget.pids = 200;
  expect(catalog.preflight(source).offer).toEqual(source);
});

it('keeps unsupported capability and hard output quota checks strict with a below-minimum budget', () => {
  const installed = registration(); installed.manifest.capabilities.push('hard-output-quota');
  const catalog = createEngineCatalog([installed]);
  for (const capability of ['unknown', 'hard-output-quota']) {
    const source = offer(installed); source.budget.cpuMillis = 999; source.requiredCapabilities = [capability];
    expect(() => catalog.preflight(source)).toThrow(expect.objectContaining({ reason: 'unapproved_engine' }));
  }
});

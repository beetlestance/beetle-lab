import { expect, it } from 'vitest';
import { join } from 'node:path';
import { RUNNER_MAXIMUM_OFFER_BYTES, validate } from '@beetle/contracts';
import type { Offer } from '@beetle/contracts';
import { createEngineCatalog } from '../../src/catalog/index.js';
import { prepareRuntime, runtimeName } from '../../src/backends/docker/index.js';
import { configDigest } from '../../src/journal/index.js';
import { admissionFixture, configuration, now, scope } from '../admission/fixtures.js';
import { fullOffer, jsonBytes } from '../integration/offer-envelope-fixtures.js';
import { offer, registration } from './fixtures.js';

const f = admissionFixture();
function distributed(): Offer {
  const source = fullOffer(offer()); source.budget.cpuMillis = 999;
  source.inputs = Array.from({ length: 128 }, (_, index) => ({ id: f.job(index + 1).attemptId, sha256: 'a'.repeat(64), bytes: 1 }));
  source.secretReferences = Array.from({ length: 64 }, (_, index) => ({ provider: 'mounted',
    name: `${index}`.padEnd(128, 'n'), reference: `${index}`.padEnd(128, 'r'), version: '\u0001'.repeat(256) }));
  return source;
}

it('retains full config and distributed input/secret payload through catalogue and durable original minimum refusal', async () => {
  const installed = registration(); const catalog = createEngineCatalog([installed]); const source = distributed();
  const original = structuredClone(source); const digest = configDigest(source.config);
  expect(validate('Offer', source).ok).toBe(true); expect(jsonBytes(source.config)).toBe(1_048_576);
  expect(source.inputs).toHaveLength(128); expect(source.secretReferences).toHaveLength(64);
  expect(jsonBytes(source)).toBe(1_185_029); expect(jsonBytes(source)).toBeLessThan(RUNNER_MAXIMUM_OFFER_BYTES);
  const found = catalog.preflight(source);
  expect(found.offer).toEqual(original); expect(source).toEqual(original); expect(found.validation.configDigest).toBe(digest);
  expect(catalog.resolve(found.offer, found.validation)).toBe(found.engine);
  const equal = { ...source, budget: { ...source.budget, cpuMillis: 1000 } };
  expect(jsonBytes(equal)).toBe(jsonBytes(source) + 1); expect(catalog.preflight(equal).offer).toEqual(equal);
  const name = runtimeName({ installationId: installed.profile.installationId, ...source, generation: 1 });
  const root = join(installed.profile.stagingRoot, name);
  expect(prepareRuntime({ offer: source, ...installed, generation: 1,
    staged: { input: join(root, 'input'), output: join(root, 'output'), secrets: join(root, 'secrets') } }))
    .toMatchObject({ ok: false, reason: 'unsupported' });
  const path = f.path(); let journal = await f.configured(path); const config = configuration();
  config.profiles = catalog.engines.map(engine => structuredClone(engine.approved));
  await journal.admission({ kind: 'configure', configuration: config });
  const command = { kind: 'offer' as const, offer: found.offer, validation: found.validation, now };
  expect(await journal.admission(command)).toEqual({ kind: 'reject', reason: 'below_manifest_minimum' });
  expect(await journal.readOffer(scope(source))).toEqual(original);
  expect(await journal.get(scope(source))).toMatchObject({ lastSeq: 0, admission: { state: 'rejected', reason: 'below_manifest_minimum' } });
  expect(await journal.admission({ kind: 'reservations', limit: 1 })).toEqual({ reservations: [] });
  await f.close(journal); journal = await f.open(path);
  expect(await journal.admission(command)).toEqual({ kind: 'reject', reason: 'below_manifest_minimum' });
  expect(await journal.readOffer(scope(source))).toEqual(original);
});

it('retains profile maximum, mixed-budget and capability guards with distributed payload', () => {
  const installed = registration(); installed.manifest.capabilities.push('hard-output-quota');
  const catalog = createEngineCatalog([installed]);
  for (const cpuMillis of [999, 1000]) {
    const source = distributed(); source.installedIdentity = offer(installed).installedIdentity;
    source.budget.cpuMillis = cpuMillis; source.budget.pids = installed.profile.maximumBudget.pids + 1;
    expect(() => catalog.preflight(source)).toThrow(expect.objectContaining({ reason: 'unapproved_engine' }));
  }
  for (const capability of ['unknown', 'hard-output-quota']) {
    const source = distributed(); source.installedIdentity = offer(installed).installedIdentity;
    source.requiredCapabilities = [capability];
    expect(() => catalog.preflight(source)).toThrow(expect.objectContaining({ reason: 'unapproved_engine' }));
  }
});

it('validates original engine configuration and original envelope before the native payload projection', () => {
  const catalog = createEngineCatalog([registration()]);
  const invalid = distributed(); invalid.config.version = 2;
  expect(() => catalog.preflight(invalid)).toThrow(expect.objectContaining({ reason: 'invalid_config' }));
  const configOverflow = fullOffer(offer(), 1_048_577);
  expect(jsonBytes(configOverflow.config)).toBe(1_048_577);
  expect(() => catalog.preflight(configOverflow)).toThrow(expect.objectContaining({ reason: 'invalid_offer' }));
  const overflow = distributed(); overflow.inputs[0]!.id = 'x'.repeat(RUNNER_MAXIMUM_OFFER_BYTES);
  expect(jsonBytes(overflow)).toBeGreaterThan(RUNNER_MAXIMUM_OFFER_BYTES);
  expect(() => catalog.preflight(overflow)).toThrow(expect.objectContaining({ reason: 'invalid_offer' }));
});

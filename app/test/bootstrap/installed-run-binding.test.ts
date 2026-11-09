import { DatabaseSync } from 'node:sqlite';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { validate } from '@beetle/contracts';
import { validateApi } from '@beetle/contracts/api';
import { seed, settingsFixture, storageFixture } from '../storage/fixture.js';
import { append, createSuite } from '../storage/suites-fixture.js';
import { runCommand, runOptions } from '../storage/runs-fixture.js';

const fixture = storageFixture();
const budget = settingsFixture().chain.installation.values.runDefaults.budget;
function agent(operation: 'describe' | 'preflight', drift = false, offer?: unknown): unknown {
  return JSON.parse(execFileSync(process.execPath, ['--import', 'tsx',
    fileURLToPath(new URL('../../../agent/test/catalog/binding-cli.ts', import.meta.url))], {
    input: JSON.stringify({ operation, budget, drift, ...(offer === undefined ? {} : { offer }) }),
    timeout: 5000, maxBuffer: 65536, encoding: 'utf8', env: { PATH: process.env.PATH },
  })) as unknown;
}
function describe(drift = false) {
  const value = agent('describe', drift);
  if (!value || typeof value !== 'object' || !('engine' in value) || !('installedIdentity' in value)) throw new Error('Invalid agent fixture');
  if (!value.engine || typeof value.engine !== 'object' || Array.isArray(value.engine)) throw new Error('Invalid agent fixture');
  const engine = validateApi('RunEngine', { ...value.engine, profileId: 'standard' });
  const identity = validate('InstalledIdentity', value.installedIdentity);
  if (!engine.ok || !identity.ok) throw new Error('Invalid agent fixture');
  return { engine: engine.value, installedIdentity: identity.value, requiredCapabilities: [] };
}

it('persists an Offer compatible with an actual registered catalogue and retains it after installation drift', async () => {
  // Deliberately synthetic budgets: no Docker, network or engine execution here.
  const installed = describe();
  const options = runOptions(); options.runs = { pendingLimit: 256, profiles: [installed] };
  const path = fixture.path(); let metadata = await fixture.open(path, options); await seed(metadata);
  const revision = await append(metadata, await createSuite(metadata));
  const command = runCommand(revision.id); const run = await metadata.runs.execute(command);
  await fixture.close(metadata);
  const db = new DatabaseSync(path);
  const originalBytes = String(db.prepare('SELECT offer_json FROM attempts WHERE id=?').get(run.activeAttemptId)!.offer_json);
  db.close();
  const offer = validate('Offer', JSON.parse(originalBytes));
  if (!offer.ok) throw new Error('Invalid persisted synthetic Offer');
  expect(offer.value.installedIdentity).toEqual(installed.installedIdentity);
  expect(agent('preflight', false, offer.value)).toEqual({ accepted: true });
  expect(offer.value.config).toEqual(revision.config);

  const changed = describe(true);
  expect(changed.engine).toEqual(installed.engine);
  expect(changed.installedIdentity.profileDigest).not.toBe(installed.installedIdentity.profileDigest);
  expect(agent('preflight', true, offer.value)).toEqual({ accepted: false, reason: 'identity' });
  options.runs!.profiles[0]!.installedIdentity = changed.installedIdentity;
  metadata = await fixture.open(path, options);
  expect(await metadata.runs.execute(runCommand(revision.id, 71, command.request))).toEqual(run);
  await fixture.close(metadata);
  const reopened = new DatabaseSync(path);
  try {
    expect(reopened.prepare('SELECT offer_json FROM attempts WHERE id=?').get(run.activeAttemptId)!.offer_json).toBe(originalBytes);
    expect(reopened.prepare('SELECT count(*) AS n FROM dispatch_outbox').get()!.n).toBe(1);
    expect(reopened.prepare('SELECT count(*) AS n FROM attempts').get()!.n).toBe(1);
  } finally { reopened.close(); }
});

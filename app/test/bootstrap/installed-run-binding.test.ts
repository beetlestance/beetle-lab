import { DatabaseSync } from 'node:sqlite';
import { expect, it } from 'vitest';
import { deriveInstalledIdentity, validate } from '@beetle/contracts';
import { createEngineCatalog } from '../../../agent/src/catalog/index.js';
import { registration } from '../../../agent/test/catalog/fixtures.js';
import { digest, seed, settingsFixture, storageFixture } from '../storage/fixture.js';
import { append, createSuite } from '../storage/suites-fixture.js';
import { runCommand, runOptions } from '../storage/runs-fixture.js';

const fixture = storageFixture();

it('persists an Offer compatible with an actual registered catalogue and retains it after installation drift', async () => {
  // Deliberately synthetic budgets: no Docker, network or engine execution here.
  const installed = registration();
  const budget = settingsFixture().chain.installation.values.runDefaults.budget;
  installed.manifest.minimumBudget = { ...budget }; installed.manifest.defaultBudget = { ...budget };
  const identity = deriveInstalledIdentity({ manifest: installed.manifest, profile: installed.profile,
    identity: installed.validation }, digest);
  const options = runOptions(); options.runs!.profiles[0]!.installedIdentity = identity;
  const path = fixture.path(); let metadata = await fixture.open(path, options); await seed(metadata);
  const revision = await append(metadata, await createSuite(metadata));
  const command = runCommand(revision.id); const run = await metadata.runs.execute(command);
  await fixture.close(metadata);
  const db = new DatabaseSync(path);
  const originalBytes = String(db.prepare('SELECT offer_json FROM attempts WHERE id=?').get(run.activeAttemptId)!.offer_json);
  db.close();
  const offer = validate('Offer', JSON.parse(originalBytes));
  if (!offer.ok) throw new Error('Invalid persisted synthetic Offer');
  const catalog = createEngineCatalog([installed]);
  expect(catalog.preflight(offer.value).offer.installedIdentity).toEqual(identity);
  expect(offer.value.config).toEqual(revision.config);

  const changed = { ...installed, profile: { ...installed.profile, tmpfsBytes: installed.profile.tmpfsBytes + 1 } };
  const changedIdentity = deriveInstalledIdentity({ manifest: changed.manifest, profile: changed.profile,
    identity: changed.validation }, digest);
  expect(changedIdentity.profileDigest).not.toBe(identity.profileDigest);
  expect(() => createEngineCatalog([changed]).preflight(offer.value)).toThrow('Engine catalog identity');
  options.runs!.profiles[0]!.installedIdentity = changedIdentity;
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

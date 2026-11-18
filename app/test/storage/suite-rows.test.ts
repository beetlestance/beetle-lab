import { beforeAll, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import type { Suite, SuiteRevision } from '@beetle/contracts/api';
import {
  captureSuiteRow,
  captureRevisionRow,
  captureRevisionSummary,
  revisionColumns,
} from '../../src/adapters/outbound/sqlite/suite-row.js';
import { digestMutationIntent } from '../../src/application/namespaces/index.js';
import { digest, scope, seed, storageFixture, uuid } from './fixture.js';
import { append, createSuite } from './suites-fixture.js';
import { rawConnection } from './raw-connection-fixture.js';
const f = storageFixture();
let suite: Suite;
let revision: SuiteRevision;
beforeAll(async () => {
  const metadata = await f.open();
  await seed(metadata);
  suite = await createSuite(metadata);
  revision = await append(metadata, suite);
  suite = await metadata.suites.getSuite({ scope, id: suite.id });
  await f.close(metadata);
});
function row() {
  return {
    id: revision.id,
    organization_id: scope.organizationId,
    workspace_id: scope.workspaceId,
    suite_id: suite.id,
    ordinal: revision.ordinal,
    digest: revision.digest,
    config_json: JSON.stringify(revision.config),
    input_manifest_json: JSON.stringify(revision.inputManifest),
    saved_at: revision.savedAt,
    message: revision.message,
    saved_by: revision.savedBy,
    run_count: 0,
    previous_revision_id: null,
  };
}
it('captures valid suite/revision rows with their existing wire values', () => {
  const summary = Object.fromEntries(Object.entries(revision).filter(([key]) => !['config', 'inputManifest'].includes(key)));
  expect(captureRevisionSummary(row(), scope, suite.id)).toEqual({ ...summary, previousRevisionId: null });
  expect(captureRevisionRow(row(), { scope, id: revision.id })).toEqual(revision);
  expect(
    captureSuiteRow(
      {
        id: suite.id,
        organization_id: scope.organizationId,
        workspace_id: scope.workspaceId,
        folder_id: suite.folderId,
        name: suite.name,
        version: suite.version,
        current_revision_id: suite.currentRevisionId,
        description: suite.description,
      },
      { scope, id: suite.id },
    ),
  ).toEqual(suite);
});
it.each([
  { id: 'invalid' },
  { organization_id: uuid(9) },
  { workspace_id: uuid(9) },
  { suite_id: 'invalid' },
  { ordinal: 1.5 },
  { ordinal: 9007199254740992 },
  { digest: 'invalid' },
  { digest: Buffer.from('a'.repeat(64)) },
  { run_count: null },
  { run_count: -1 },
])('refuses corrupt revision summary %j', (amendment) => {
  expect(() => captureRevisionSummary({ ...row(), ...amendment }, scope, suite.id)).toThrow();
});
it.each([
  { config_json: 'invalid' },
  { config_json: 'null' },
  { config_json: '[]' },
  { config_json: '{}' },
  { config_json: Buffer.from('{}') },
  { input_manifest_json: 'invalid' },
  { input_manifest_json: '{}' },
])('refuses malformed revision content %j', (amendment) => {
  expect(() => captureRevisionRow({ ...row(), ...amendment }, { scope, id: revision.id })).toThrow();
});
it('refuses changed valid configuration when its stored digest no longer matches', () => {
  const changed = { ...revision.config, target: 'http://different.invalid' };
  expect(() =>
    captureRevisionRow({ ...row(), config_json: JSON.stringify(changed) }, { scope, id: revision.id }),
  ).toThrow();
});
it('refuses a valid manifest/digest pair when the configuration does not reference those pins', () => {
  const inputManifest = [{ id: uuid(90), sha256: 'a'.repeat(64), bytes: 12 }];
  const changedDigest = digestMutationIntent(
    { engineId: 'k6', configVersion: 1, config: revision.config, inputManifest },
    digest,
  );
  expect(() =>
    captureRevisionRow(
      { ...row(), input_manifest_json: JSON.stringify(inputManifest), digest: changedDigest },
      { scope, id: revision.id },
    ),
  ).toThrow();
});
it('bounds revision JSON before JavaScript parsing', () => {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec(
      'CREATE TABLE suite_revisions(id,organization_id,workspace_id,suite_id,ordinal,digest,config_json,input_manifest_json,' +
        'saved_at,message,saved_by);' +
        'CREATE TABLE suite_revision_run_counts(revision_id,run_count)',
    );
    db.prepare('INSERT INTO suite_revisions VALUES(?,?,?,?,?,?,?,?,NULL,NULL,NULL)').run(
      revision.id,
      scope.organizationId,
      scope.workspaceId,
      suite.id,
      1,
      revision.digest,
      'X'.repeat(2097153),
      Buffer.from('[]'),
    );
    const projected = db.prepare(`SELECT ${revisionColumns} FROM suite_revisions`).get();
    expect(projected?.config_json).toBeNull();
    expect(projected?.input_manifest_json).toBeNull();
    expect(() => captureRevisionRow(projected, { scope, id: revision.id })).toThrow();
  } finally {
    db.close();
  }
});
it('refuses a corrupt revision overflow row before issuing a cursor', async () => {
  const path = f.path();
  const original = await f.open(path);
  await seed(original);
  const first = await append(original, await createSuite(original));
  const updated = await original.suites.getSuite({ scope, id: first.suiteId });
  const second = await append(original, updated, 61);
  await f.close(original);
  const db = rawConnection(path);
  try {
    const guard = db.prepare("SELECT sql FROM sqlite_master WHERE name='revisions_no_update'").get()?.sql;
    if (typeof guard !== 'string') throw Error('Missing real immutable revision guard');
    db.exec('DROP TRIGGER revisions_no_update');
    db.prepare('UPDATE suite_revisions SET ordinal=? WHERE id=?').run(2.5, second.id);
    db.exec(guard);
  } finally {
    db.close();
  }
  const metadata = await f.open(path);
  await expect(metadata.suites.listRevisions({ scope, suiteId: first.suiteId, limit: 1 })).rejects.toMatchObject({
    code: 'unavailable',
  });
});

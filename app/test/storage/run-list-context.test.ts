import { expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { readRunListContexts } from '../../src/adapters/outbound/sqlite/run-list-context.js';
import { scope, seed, storageFixture, command, requestId } from './fixture.js';
import { append, createSuite } from './suites-fixture.js';
import { runCommand, runOptions } from './runs-fixture.js';

const fixture = storageFixture();
it('joins candidate names and exact revision ordinals without exposing revision configuration', async () => {
  const metadata = await fixture.open(undefined, runOptions());
  const namespace=await seed(metadata);
  const suite = await createSuite(metadata);
  const revision = await append(metadata, suite);
  const run = await metadata.runs.execute(runCommand(revision.id));
  const page = await metadata.runs.listRuns({ scope, limit: 10 });
  expect(page.workspaceName).toBe(namespace.workspace.name);
  await metadata.namespaces.execute(command({kind:'patchWorkspace',id:namespace.workspace.id,request:{requestId:requestId(),scope:{kind:'organization',organizationId:scope.organizationId},expectedVersion:namespace.workspace.version,name:'Renamed workspace'}}));
  expect((await metadata.runs.listRuns({scope,limit:10})).workspaceName).toBe('Renamed workspace');
  expect(page.contexts).toEqual([
    {
      runId: run.id,
      suiteId: suite.id,
      revisionId: revision.id,
      suiteName: suite.name,
      revisionOrdinal: revision.ordinal,
    },
  ]);
  expect(page.contexts?.[0]).not.toHaveProperty('config');
});

it('refuses corrupt joined scalar data rather than labelling a run with invented metadata', async () => {
  const metadata = await fixture.open(undefined, runOptions());
  await seed(metadata);
  const suite = await createSuite(metadata);
  const revision = await append(metadata, suite);
  const run = await metadata.runs.execute(runCommand(revision.id));
  const db = new DatabaseSync(':memory:');
  try {
    db.exec(`CREATE TABLE runs(id TEXT PRIMARY KEY,organization_id TEXT,workspace_id TEXT,suite_id TEXT,revision_id TEXT);
      CREATE TABLE suites(id TEXT PRIMARY KEY,organization_id TEXT,workspace_id TEXT,name TEXT);
      CREATE TABLE suite_revisions(id TEXT PRIMARY KEY,organization_id TEXT,workspace_id TEXT,suite_id TEXT,ordinal INTEGER,digest TEXT);`);
    db.prepare('INSERT INTO runs VALUES(?,?,?,?,?)').run(
      run.id,
      scope.organizationId,
      scope.workspaceId,
      suite.id,
      revision.id,
    );
    db.prepare('INSERT INTO suites VALUES(?,?,?,?)').run(suite.id, scope.organizationId, scope.workspaceId, suite.name);
    db.prepare('INSERT INTO suite_revisions VALUES(?,?,?,?,?,?)').run(
      revision.id,
      scope.organizationId,
      scope.workspaceId,
      suite.id,
      revision.ordinal,
      run.revisionDigest,
    );
    expect(readRunListContexts(db, scope, [run])).toHaveLength(1);
    for (const [column, value] of [
      ['digest', 'f'.repeat(64)],
      ['ordinal', 0],
      ['workspace_id', run.id],
    ] as const) {
      db.prepare(`UPDATE suite_revisions SET ${column}=?`).run(value);
      expect(() => readRunListContexts(db, scope, [run])).toThrow();
      db.prepare('UPDATE suite_revisions SET digest=?,ordinal=?,workspace_id=?').run(
        run.revisionDigest,
        revision.ordinal,
        scope.workspaceId,
      );
    }
    db.prepare('UPDATE suites SET name=?').run('x'.repeat(513));
    expect(() => readRunListContexts(db, scope, [run])).toThrow();
  } finally {
    db.close();
  }
});

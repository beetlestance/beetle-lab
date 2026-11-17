import { expect, it, vi } from 'vitest';
import type { StatementSync } from 'node:sqlite';
import { initialize } from '../../src/adapters/outbound/sqlite/schema.js';
import { Entities } from '../../src/adapters/outbound/sqlite/entities.js';
import { Reads } from '../../src/adapters/outbound/sqlite/reads.js';
import { InputReads } from '../../src/adapters/outbound/sqlite/input-reads.js';
import { Suites } from '../../src/adapters/outbound/sqlite/suites.js';
import { SuiteReads } from '../../src/adapters/outbound/sqlite/suite-reads.js';
import { RunReads } from '../../src/adapters/outbound/sqlite/run-reads.js';
import { scope, seed, storageFixture, uuid } from './fixture.js';
import { createInput, inputOptions } from './inputs-fixture.js';
import { append, createSuite } from './suites-fixture.js';
import { runCommand, runOptions } from './runs-fixture.js';
const f = storageFixture();
it('keeps actual bounded list projections on indexed source-key ordering', async () => {
  const path = f.path();
  const metadata = await f.open(path, { ...inputOptions(), ...runOptions() });
  await seed(metadata);
  const suite = await createSuite(metadata);
  const revision = await append(metadata, suite);
  await metadata.runs.execute(runCommand(revision.id));
  await metadata.inputs.control(createInput());
  await f.close(metadata);
  const db = initialize(path);
  const prepare = db.prepare.bind(db);
  const observed: { sql: string; args: Parameters<StatementSync['all']> }[] = [];
  const spy = vi.spyOn(db, 'prepare').mockImplementation((sql) => {
    const statement = prepare(sql);
    const all = statement.all.bind(statement);
    vi.spyOn(statement, 'all').mockImplementation((...args) => {
      if (sql.includes('ORDER BY') && !sql.includes('WITH RECURSIVE')) observed.push({ sql, args });
      return all(...args);
    });
    return statement;
  });
  try {
    const entities = new Entities(db);
    const reads = new Reads(db, entities);
    const suites = new Suites(db, entities);
    reads.list({ kind: 'organization', scope: { kind: 'installation' }, limit: 1 });
    reads.list({ kind: 'workspace', scope: { kind: 'organization', organizationId: scope.organizationId }, limit: 1 });
    reads.list({ kind: 'folder', scope, limit: 1 });
    reads.list({ kind: 'folder', scope, parentFolderId: uuid(3), limit: 1 });
    const inputs = new InputReads(db, entities);
    inputs.list({ scope, limit: 1 });
    inputs.list({ limit: 1 });
    const suiteReads = new SuiteReads(db, suites);
    suiteReads.list({ scope, limit: 1 });
    suiteReads.list({ scope, suiteId: suite.id, limit: 1 });
    new RunReads(db, suites).list({ scope, limit: 1 });
    expect(observed.length).toBeGreaterThanOrEqual(9);
    for (const query of observed) {
      const details = prepare('EXPLAIN QUERY PLAN ' + query.sql)
        .all(...query.args)
        .map((row) => String(row.detail))
        .join('\n');
      expect(details, query.sql).not.toMatch(/TEMP B-TREE.*ORDER BY/);
    }
  } finally {
    spy.mockRestore();
    db.close();
  }
});

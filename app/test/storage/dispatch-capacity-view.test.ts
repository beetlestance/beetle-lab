import { expect, it } from 'vitest';
import { claimsFixture, custody } from './dispatch-claim-fixtures.js';
import { scope, uuid } from './fixture.js';
import { runCapacityFact, runCapacityFactSql } from '../../src/adapters/outbound/sqlite/dispatch-candidates.js';
it('reads individual capacity without changing custody and confines the real query to one scoped attempt', () => {
  const f = claimsFixture(4_000_000);
  try {
    const key = f.add();
    const run = f.reads.get({ scope, id: key.runId });
    const before = custody(f.db);
    expect(f.claims.capacityReason(run)).toBeNull();
    f.settings.updateRuntime(null);
    expect(f.claims.capacityReason(run)).toBe('capacity_unknown');
    expect(custody(f.db)).toEqual(before);
    expect(runCapacityFact(f.db, { ...run, scope: { ...scope, workspaceId: uuid(99) } })).toBeUndefined();
    const plan = f.db
      .prepare('EXPLAIN QUERY PLAN ' + runCapacityFactSql)
      .all(run.activeAttemptId, run.id, scope.organizationId, scope.workspaceId)
      .map((row) => String(row.detail))
      .join('\n');
    expect(plan).toMatch(/SEARCH a USING INDEX/);
    expect(plan).not.toMatch(/\bSCAN\b/);
  } finally {
    f.db.close();
  }
});

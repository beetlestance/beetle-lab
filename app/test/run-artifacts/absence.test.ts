import { expect, it } from 'vitest';
import { RunArtifacts } from '../../src/adapters/outbound/sqlite/run-artifacts/index.js';
import { absenceFixture } from '../output-absence/fixture.js';
import { scope } from '../storage/fixture.js';
it('only a matched source-free finalization grants absent metadata, without reads changing accounting', () => {
  const f = absenceFixture(); const reader = new RunArtifacts(f.db, f.reads);
  const query = {id: f.key.runId, scope, attemptId: f.key.attempt.attemptId, limit: 100};
  f.ready(); expect(reader.execute({kind: 'listRunArtifacts', query})).toMatchObject({availability: 'pending'});
  expect(f.finalize()).toMatchObject({kind: 'finalized'}); const before = f.facts();
  expect(reader.execute({kind: 'listRunArtifacts', query})).toMatchObject({availability: 'absent', manifestDigest: null, items: [], nextCursor: null});
  expect(f.facts()).toEqual(before);
});

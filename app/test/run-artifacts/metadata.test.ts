import { expect, it } from 'vitest';
import { RunArtifacts } from '../../src/adapters/outbound/sqlite/run-artifacts/index.js';
import { finalizationFixture } from '../output-finalization/fixture.js';
import { guardsOff } from '../run-results/fixture.js';
import { scope, uuid } from '../storage/fixture.js';
const operation = (f: ReturnType<typeof finalizationFixture>) => ({kind: 'listRunArtifacts' as const,
  query: {id: f.key.runId, scope, attemptId: f.key.attempt.attemptId, limit: 100}});
it('pending and finalized empty metadata are bounded read-only projections through actual publication evidence', () => {
  const f = finalizationFixture(); const reader = new RunArtifacts(f.db, f.reads); const op = operation(f);
  expect(reader.execute(op)).toMatchObject({availability: 'pending', items: [], manifestDigest: null});
  f.ready(); const before = f.facts();
  expect(reader.execute(op)).toMatchObject({availability: 'pending'}); expect(f.facts()).toEqual(before);
  expect(f.finalize().kind).toBe('finalized'); const settled = f.facts();
  expect(reader.execute(op)).toMatchObject({availability: 'ready', items: [], manifestDigest: f.envelope.manifest.manifestDigest});
  expect(f.facts()).toEqual(settled);
});
it('requested attempt and scoped ownership are independently enforced', () => {
  const f = finalizationFixture(); const reader = new RunArtifacts(f.db, f.reads); const op = operation(f);
  for (const query of [{...op.query, scope: {...scope, workspaceId: uuid(900)}}, {...op.query, attemptId: uuid(901)}, {...op.query, id: uuid(902)}]) {
    expect(() => reader.execute({kind: op.kind, query})).toThrow(expect.objectContaining({code: 'not_found'}));
  }
  expect(() => reader.execute({kind: 'getRunArtifact', key: {...op.query, artifactId: uuid(501)}})).toThrow();
});
it('does not turn contradictory finalization evidence into successful metadata', () => {
  const f = finalizationFixture(); f.ready(); f.finalize(); f.db.exec('PRAGMA foreign_keys=OFF'); guardsOff(f.db, 'execution_output_finalizations');
  f.db.prepare('UPDATE execution_output_finalizations SET source_digest=?').run('f'.repeat(64));
  expect(() => new RunArtifacts(f.db, f.reads).execute(operation(f))).toThrow(expect.objectContaining({code: 'unavailable'}));
});
it('keeps requested retained attempt evidence readable after the active head and its engine pins change', () => {
  const f = finalizationFixture(); f.ready(); f.finalize();
  const next = f.add(74); guardsOff(f.db, 'runs'); guardsOff(f.db, 'attempts');
  f.db.exec('PRAGMA foreign_keys=OFF');
  f.db.prepare('UPDATE attempts SET run_id=?,ordinal=2 WHERE id=?').run(f.key.runId, next.attempt.attemptId);
  // Controlled head change: requested ownership remains in the original attempts row.
  f.db.prepare(`UPDATE runs SET active_attempt_id=?,snapshot_json=json_set(snapshot_json,'$.engine.imageDigest','sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff') WHERE id=?`)
    .run(next.attempt.attemptId, f.key.runId);
  const reader = new RunArtifacts(f.db, f.reads);
  expect(reader.execute(operation(f))).toMatchObject({availability: 'ready', attemptId: f.key.attempt.attemptId});
});

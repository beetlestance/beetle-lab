import { expect, it } from 'vitest';
import { prepareCancelRunCommand } from '../../src/application/runs/index.js';
import { absentProjection } from '../../src/adapters/outbound/sqlite/migration029.js';
import { migration040 } from '../../src/adapters/outbound/sqlite/migration040.js';
import { transaction } from '../../src/adapters/outbound/sqlite/schema.js';
import { digest, requestId, scope } from '../storage/fixture.js';
import { absenceFixture } from './fixture.js';

const exitEvidence = {
  exitCode: 137,
  oomKilled: true,
  reason: 'memory_limit',
  observedAt: '2026-01-01T00:01:00Z',
} as const;

it.each(['cancelled', 'output_limit', 'artifact_incomplete'] as const)(
  'preserves verified OOM over a source-free %s proof',
  (reason) => {
    const f = absenceFixture({ reason });
    f.adopt();
    f.release({ exitEvidence });
    f.ingest();
    f.confirm();
    if (reason !== 'cancelled') {
      f.store.execute({
        kind: 'cancelRun',
        command: prepareCancelRunCommand(
          { kind: 'cancelRun', id: f.key.runId, request: { scope, requestId: requestId() } },
          digest,
        ),
      });
    }
    const proof = f.db.prepare('SELECT * FROM execution_output_absences').get();
    const before = f.usage();
    const reply = f.finalize();
    expect(reply).toMatchObject({
      kind: 'finalized',
      receipt: { state: 'errored', outcome: 'inconclusive', reason: 'memory_limit' },
    });
    expect(f.db.prepare('SELECT * FROM execution_output_absences').get()).toEqual(proof);
    const after = f.usage();
    expect(after).toBeLessThan(before);
    expect(f.finalize()).toEqual(reply);
    expect(f.usage()).toBe(after);
  },
);

it.each([false, null] as const)('an exit 137 with OOM evidence %s cannot establish an OOM', (oomKilled) => {
  const f = absenceFixture({ reason: 'cancelled' });
  f.adopt();
  f.release({ exitEvidence: { exitCode: 137, oomKilled, observedAt: exitEvidence.observedAt } });
  f.ingest();
  f.confirm();
  expect(f.finalize()).toEqual({ kind: 'pending', reason: 'execution' });
});

it('requires the exact final sequence and acknowledged events even for a verified OOM', () => {
  const f = absenceFixture({ end: 3 });
  f.adopt();
  f.release({ lastSeq: 2, exitEvidence });
  f.ingest();
  expect(f.finalize()).toEqual({ kind: 'pending', reason: 'execution' });
  f.release({ exitEvidence });
  expect(f.finalize()).toEqual({ kind: 'pending', reason: 'events' });
  f.confirm();
  expect(f.finalize()).toMatchObject({ kind: 'finalized', receipt: { reason: 'memory_limit' } });
});

it('keeps never-started attempts from projecting an OOM', () => {
  const f = absenceFixture({ reason: 'setup_failed', admission: { state: 'released', disposition: 'never_started' } });
  f.adopt();
  f.release({ exitEvidence });
  f.ingest();
  f.confirm();
  expect(f.finalize()).toMatchObject({ kind: 'finalized', receipt: { reason: 'setup_failed' } });
});

it('preserves a prior receipt and charge when upgrading an already finalized run', () => {
  const f = absenceFixture();
  transaction(f.db, () => f.db.exec(`DROP VIEW output_absence_evidence;${absentProjection}PRAGMA user_version=39;`));
  f.adopt();
  f.release({ exitEvidence });
  f.ingest();
  f.confirm();
  const receipt = f.finalize();
  expect(receipt).toMatchObject({ kind: 'finalized', receipt: { reason: 'artifact_incomplete' } });
  const charge = f.usage();
  transaction(f.db, () => f.db.exec(migration040));
  expect(f.db.prepare('PRAGMA user_version').get()?.user_version).toBe(40);
  expect(f.finalize()).toEqual(receipt);
  expect(f.reads.get({ id: f.key.runId, scope }).state).toBe('errored');
  expect(f.usage()).toBe(charge);
});

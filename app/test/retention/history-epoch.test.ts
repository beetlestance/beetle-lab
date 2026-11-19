import { expect, it } from 'vitest';
import { migration025 } from '../../src/adapters/outbound/sqlite/migration025.js';
import { migration038 } from '../../src/adapters/outbound/sqlite/migration038.js';
import { transaction } from '../../src/adapters/outbound/sqlite/schema.js';
import type { RunHistoryJob } from '../../src/ports/run-history.js';
import { HistorySummaries } from '../../src/adapters/outbound/sqlite/run-history/index.js';
import { ManualRunDeletionSnapshots } from '../../src/adapters/outbound/sqlite/retention-manual/index.js';
import { WorkspaceRetentionApplies } from '../../src/adapters/outbound/sqlite/retention-apply/index.js';
import { command, scope, uuid } from './selection-fixture.js';
import { epoch, pin } from '../storage/run-pin-fixtures.js';
import { usage } from './fixture.js';
import { published, summary } from '../storage/run-history-summary/fixture.js';

function fixture() {
  const f = published();
  f.policy((values) => {
    values.retention = { mode: 'manual' };
    values.pool.storageBytes = 4_000_000;
  });
  const row = f.db.prepare('SELECT id,version,active_attempt_id FROM runs LIMIT 1').get()!;
  const { page, ...request } = command(f).request;
  void page;
  const preview = new ManualRunDeletionSnapshots(f.db, f.reads).preview({
    ...command(f),
    request: { ...request, runId: String(row.id), expectedRunVersion: Number(row.version) },
  });
  const input = {
    id: uuid(55000),
    appliedAt: '2026-11-14T12:01:00.000Z',
    request: {
      scope,
      requestId: uuid(55001),
      settingsId: preview.settings.workspace.id,
      expectedVersion: preview.settings.workspace.version,
      snapshotId: preview.id,
      snapshotVersion: 1,
      page: { limit: 1 },
    },
  };
  const histories = new HistorySummaries(f.db);
  const [job] = histories.execute({
    kind: 'historySummary',
    operation: { method: 'scan', query: { nowMs: Date.now(), limit: 1 } },
  }) as RunHistoryJob[];
  expect(job?.id).toBe(row.id);
  return { ...f, row, job: job!, histories, input, apply: new WorkspaceRetentionApplies(f.db, f.reads) };
}

for (const legacy of [true, false])
  for (const method of ['defer', 'commit'] as const) {
    it(`history ${method}: ${legacy ? 'old blanket trigger refuses' : 'derived cache keeps preview valid'}`, () => {
      const f = fixture();
      {
        if (legacy) {
          const old = /CREATE TRIGGER retention_run_update[\s\S]*?END;/.exec(migration025)![0];
          transaction(f.db, () => f.db.exec('DROP TRIGGER retention_run_update;' + old));
        }
        const before = epoch(f.db);
        const charge = usage(f.db);
        const operation =
          method === 'defer'
            ? { method, request: { job: f.job, dueMs: f.job.expectedDueMs + 1000 } }
            : { method, request: { job: f.job, summary: summary(f.job) } };
        f.histories.execute({ kind: 'historySummary', operation });
        expect(f.db.prepare('SELECT version FROM runs WHERE id=?').get(f.job.id)?.version).toBe(f.row.version);
        expect(usage(f.db)).toBe(charge);
        if (legacy) {
          expect(epoch(f.db)).toBe(before + 1);
          expect(() => f.apply.apply(f.input)).toThrow('conflict');
          expect(f.db.prepare('SELECT 1 FROM output_deletion_intents').get()).toBeUndefined();
          return;
        }
        const cachedEpoch = epoch(f.db);
        expect(f.apply.apply(f.input)).toMatchObject({ state: 'admitted', maximumCandidates: 1 });
        expect(cachedEpoch).toBe(before);
        expect(epoch(f.db)).toBe(before + 1);
      }
    });
  }

it('still expires a preview after pin/unpin ABA even when the Run version is unchanged', () => {
  const f = fixture();
  {
    const before = epoch(f.db);
    pin(f, 'pinRun', f.job.id, uuid(56000));
    pin(f, 'unpinRun', f.job.id, uuid(56001));
    expect(epoch(f.db)).toBe(before + 2);
    expect(f.db.prepare('SELECT version FROM runs WHERE id=?').get(f.job.id)?.version).toBe(f.row.version);
    transaction(f.db, () => f.db.exec(migration038));
    expect(() => f.apply.apply(f.input)).toThrow('conflict');
    expect(f.db.prepare('SELECT 1 FROM output_deletion_intents').get()).toBeUndefined();
  }
});

for (const update of ['reason=reason', 'reason=reason,history_summary_due_ms=1000']) {
  it(`still invalidates for meaningful Run writes: ${update}`, () => {
    const f = fixture();
    {
      const before = epoch(f.db);
      f.db.prepare(`UPDATE runs SET ${update} WHERE id=?`).run(f.job.id);
      expect(epoch(f.db)).toBe(before + 1);
      expect(() => f.apply.apply(f.input)).toThrow('conflict');
      expect(f.db.prepare('SELECT 1 FROM output_deletion_intents').get()).toBeUndefined();
    }
  });
}

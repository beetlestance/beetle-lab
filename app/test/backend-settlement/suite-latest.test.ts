import { expect, it } from 'vitest';
import { fixture } from './fixture.js';
import { prepareRunCommand } from '../../src/application/runs/index.js';
import { digest, uuid } from '../storage/fixture.js';
import { runRequest } from '../storage/runs-fixture.js';

const latest = (f: ReturnType<typeof fixture>) =>
  f.db.prepare('SELECT latest_run_id,latest_requested_at,latest_group FROM suites WHERE id=?').get(uuid(50));
const count = (f: ReturnType<typeof fixture>) =>
  f.db.prepare('SELECT run_count FROM suite_revision_run_counts WHERE revision_id=?').get(uuid(60))?.run_count;
it('settlement purge of the latest Run reveals the previous retained Run and decrements its revision count', () => {
  const f = fixture();
  const settled = f.db.prepare('SELECT run_id FROM backend_cleanup_controls').get()?.run_id;
  const older = '2026-01-01T00:00:00.000Z';
  f.store.execute({
    kind: 'run',
    command: prepareRunCommand(
      { kind: 'createRun', id: uuid(95), attemptId: uuid(195), requestedAt: older, request: runRequest(uuid(60)) },
      digest,
    ),
  });
  expect(latest(f)).toMatchObject({ latest_run_id: settled });
  expect(count(f)).toBe(2);
  f.settle();
  expect(f.db.prepare('SELECT id FROM runs WHERE id=?').get(String(settled))).toBeUndefined();
  expect(latest(f)).toEqual({ latest_run_id: uuid(95), latest_requested_at: older, latest_group: 'in_progress' });
  expect(count(f)).toBe(1);
});
it('settlement still refuses every other suite column', () => {
  const f = fixture();
  f.db.exec(`CREATE TEMP TRIGGER rename_on_purge AFTER DELETE ON main.runs
    BEGIN UPDATE suites SET name=name||'x' WHERE id=OLD.suite_id; END`);
  expect(() => f.settle()).toThrow();
  expect(f.db.prepare('SELECT count(*) AS n FROM runs').get()?.n).toBeGreaterThan(0);
});

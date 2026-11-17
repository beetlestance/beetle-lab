import { expect, it } from 'vitest';
import { history, command, scope, uuid } from './selection-fixture.js';
import { selected } from './apply-fixture.js';
import { ManualRunDeletionSnapshots } from '../../src/adapters/outbound/sqlite/retention-manual/index.js';
import { WorkspaceRetentionApplies } from '../../src/adapters/outbound/sqlite/retention-apply/index.js';
import { epoch, pin, pinCommand, runIds } from '../storage/run-pin-fixtures.js';
import { storageFixture } from '../storage/fixture.js';
const storage = storageFixture();
const intents = (f: { db: { prepare(sql: string): { get(): Record<string, unknown> | undefined } } }) =>
  Number(f.db.prepare('SELECT count(*) n FROM output_deletion_intents').get()?.n);

it('never selects a pinned run but still counts it toward completed and storage figures', () => {
  const f = history(3);
  try {
    f.policy(values => { values.retention = { mode: 'enabled', ageDays: 1 }; });
    const unpinned = f.retention.preview(command(f, 0));
    const [oldest] = runIds(f.db); pin(f, 'pinRun', oldest!, uuid(9000));
    const page = f.retention.preview(command(f, 1));
    expect(page.candidates.map(candidate => candidate.id)).not.toContain(oldest);
    expect(page.candidates).toHaveLength(unpinned.candidates.length - 1);
    expect(page.exclusions).toContainEqual(expect.objectContaining({ reason: 'pinned', count: 1 }));
    expect(page.before).toEqual(unpinned.before);
    expect(page.after).toEqual(unpinned.after); expect(page.after.completedCount).toBe(3);
  } finally { f.db.close(); }
});

it('refuses manual deletion of a pinned run as run_pinned without funding a snapshot', () => {
  const f = history(1);
  try {
    f.policy(values => { values.retention = { mode: 'manual' }; });
    const row = f.db.prepare('SELECT id,version FROM runs LIMIT 1').get()!; const base = command(f);
    const { page, ...request } = base.request; void page;
    const input = { ...base, request: { ...request, runId: String(row.id), expectedRunVersion: Number(row.version) } };
    pin(f, 'pinRun', String(row.id), uuid(9100));
    expect(() => new ManualRunDeletionSnapshots(f.db, f.reads).preview(input)).toThrow('run_pinned');
    expect(f.db.prepare('SELECT 1 FROM retention_snapshots').get()).toBeUndefined();
  } finally { f.db.close(); }
});

it('makes an outstanding preview stale after pin and still refuses removal when the epoch check is bypassed', () => {
  const stale = selected();
  try {
    const before = epoch(stale.db); pin(stale, 'pinRun', stale.page.candidates[0]!.id, uuid(9200));
    expect(epoch(stale.db)).toBe(before + 1);
    expect(() => stale.apply.apply(stale.input)).toThrow('conflict');
    expect(intents(stale)).toBe(0);
  } finally { stale.db.close(); }
  const f = selected();
  try {
    f.db.exec('DROP TRIGGER run_pin_epoch_insert');
    pin(f, 'pinRun', f.page.candidates[1]!.id, uuid(9201));
    expect(() => new WorkspaceRetentionApplies(f.db, f.reads).apply(f.input)).toThrow('run_pinned');
    expect(intents(f)).toBe(0);
  } finally { f.db.close(); }
});

it('serializes concurrent pin and Apply admission through one worker so a run is never both pinned and admitted', async () => {
  for (const order of ['pin-first', 'apply-first'] as const) {
    const f = selected(); const path = storage.path(); f.db.prepare('VACUUM INTO ?').run(path);
    const installation = f.settings.chain(scope).installation; const target = f.page.candidates[0]!.id; f.db.close();
    const metadata = await storage.open(path, { runtime: null, runs: f.config, installation });
    try {
      const pinning = () => metadata.runs.pin(pinCommandFor(target));
      const applying = () => metadata.retention.apply(f.input);
      const settled = await Promise.allSettled(order === 'pin-first' ? [pinning(), applying()] : [applying(), pinning()]);
      const [pinResult, applyResult] = order === 'pin-first' ? settled : [settled[1]!, settled[0]!];
      const run = await metadata.runs.getRun({ scope, id: target });
      if (order === 'pin-first') {
        expect(pinResult.status).toBe('fulfilled'); expect(applyResult).toMatchObject({ status: 'rejected', reason: { code: 'conflict' } });
        expect(run.pinned).toBe(true);
      } else {
        expect(applyResult).toMatchObject({ status: 'fulfilled', value: { state: 'admitted' } });
        expect(pinResult).toMatchObject({ status: 'rejected', reason: { code: 'cleanup_in_progress' } });
        expect(run.pinned).toBe(false);
      }
    } finally { await storage.close(metadata); }
  }
});
function pinCommandFor(id: string) { return pinCommand('pinRun', id, uuid(9300)); }

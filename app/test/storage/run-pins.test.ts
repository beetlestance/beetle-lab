import { expect, it } from 'vitest';
import { history } from '../retention/selection-fixture.js';
import { selected } from '../retention/apply-fixture.js';
import { otherWorkspace } from '../retention/fixture.js';
import { prepareNamespaceDeletion } from '../../src/application/namespace-deletion/index.js';
import { digest, requestId, scope, uuid } from './fixture.js';
import { epoch, pin, pinCommand, pinnedAt, pins, runIds } from './run-pin-fixtures.js';

it('pins a terminal run once, replays the first receipt and advances the retention epoch per change', () => {
  const f = history(2);
  try {
    const [first] = runIds(f.db); const before = epoch(f.db);
    const receipt = pin(f, 'pinRun', first!, uuid(7000));
    expect(receipt).toEqual({ id: first, scope, requestId: uuid(7000), pinned: true, pinnedAt });
    expect(f.reads.get({ scope, id: first! })).toMatchObject({ pinned: true, pinnedAt });
    expect(epoch(f.db)).toBe(before + 1);
    expect(f.store.execute({ kind: 'runPin', command: pinCommand('pinRun', first!, uuid(7001), scope, '2026-11-14T12:05:00.000Z') })).toEqual({ ...receipt, requestId: uuid(7001) });
    expect(epoch(f.db)).toBe(before + 1);
    expect(pin(f, 'unpinRun', first!, uuid(7002))).toEqual({ id: first, scope, requestId: uuid(7002), pinned: false });
    expect(epoch(f.db)).toBe(before + 2);
    const read = f.reads.get({ scope, id: first! });
    expect(read.pinned).toBe(false); expect(read).not.toHaveProperty('pinnedAt');
    expect(pin(f, 'pinRun', first!, uuid(7000))).toEqual(receipt);
    expect(pins(f.db)).toEqual([]);
    expect(pin(f, 'unpinRun', first!, uuid(7003))).toEqual({ id: first, scope, requestId: uuid(7003), pinned: false });
    expect(epoch(f.db)).toBe(before + 2);
    expect(() => pin(f, 'unpinRun', first!, uuid(7000))).toThrow('conflict');
  } finally { f.db.close(); }
});

it('refuses nonterminal runs, foreign scopes and admitted removal without writing a receipt', () => {
  const f = selected();
  try {
    const receipts = () => f.db.prepare('SELECT count(*) n FROM receipts').get()?.n;
    f.apply.apply(f.input);
    const admitted = receipts();
    expect(() => pin(f, 'pinRun', f.page.candidates[0]!.id, uuid(7102))).toThrow('cleanup_in_progress');
    const active = f.add(99); const target = otherWorkspace(f); const before = receipts();
    expect(() => pin(f, 'pinRun', active.runId, uuid(7100))).toThrow('run_active');
    expect(() => pin(f, 'pinRun', f.page.candidates[1]!.id, uuid(7101), target)).toThrow(expect.objectContaining({ code: 'not_found' }));
    expect(pins(f.db)).toEqual([]); expect(receipts()).toBe(before); expect(Number(before)).toBeGreaterThanOrEqual(Number(admitted));
  } finally { f.db.close(); }
});

it('admits 256 pins per workspace and refuses the next with pin_limit', () => {
  const f = history(257);
  try {
    const ids = runIds(f.db);
    ids.slice(0, 256).forEach((id, index) => pin(f, 'pinRun', id, uuid(8000 + index)));
    expect(() => pin(f, 'pinRun', ids[256]!, uuid(8300))).toThrow('pin_limit');
    expect(pins(f.db)).toHaveLength(256);
    pin(f, 'unpinRun', ids[0]!, uuid(8301));
    expect(pin(f, 'pinRun', ids[256]!, uuid(8302))).toMatchObject({ pinned: true });
  } finally { f.db.close(); }
}, 60_000);

it('repeats every adapter refusal in the SQL guards', () => {
  const f = selected();
  try {
    const [id] = f.page.candidates.map(candidate => candidate.id); const active = f.add(99);
    const insert = f.db.prepare('INSERT INTO run_pins(run_id,organization_id,workspace_id,pinned_at,request_id) VALUES(?,?,?,?,?)');
    expect(() => insert.run(active.runId, scope.organizationId, scope.workspaceId, pinnedAt, uuid(7200))).toThrow('terminal');
    pin(f, 'pinRun', id!, uuid(7201));
    expect(() => f.db.prepare('UPDATE run_pins SET pinned_at=?').run('2026-11-14T12:09:00.000Z')).toThrow('immutable run pin');
    const run = f.reads.get({ scope, id: id! });
    expect(() => f.db.prepare(`INSERT INTO output_deletion_intents(id,run_id,attempt_id,organization_id,workspace_id,request_id,run_version,
      deletion_version,version,kind,requested_at,retained_payload_bytes,metadata_bytes,file_count,pending_files)
      VALUES(?,?,?,?,?,?,?,1,1,'unsent',?,0,0,0,0)`).run(uuid(7202), run.id, run.activeAttemptId, scope.organizationId, scope.workspaceId,
      uuid(7203), run.version, pinnedAt)).toThrow('pinned run');
    expect(() => f.apply.apply(f.input)).toThrow();
    expect(f.db.prepare('SELECT count(*) n FROM output_deletion_intents').get()?.n).toBe(0);
  } finally { f.db.close(); }
});

it('keeps pins with a retired workspace and refuses changes after retirement', () => {
  const f = history(1);
  try {
    const [id] = runIds(f.db); pin(f, 'pinRun', id!, uuid(7300)); const kept = pins(f.db);
    f.store.execute({ kind: 'deleteNamespace', command: prepareNamespaceDeletion({ kind: 'workspace', id: scope.workspaceId,
      request: { scope: { kind: 'organization', organizationId: scope.organizationId }, requestId: requestId(), expectedVersion: 1 } }, digest) });
    expect(() => pin(f, 'unpinRun', id!, uuid(7301))).toThrow(expect.objectContaining({ code: 'not_found' }));
    expect(() => f.db.prepare('DELETE FROM run_pins').run()).toThrow('retained run pin');
    expect(pins(f.db)).toEqual(kept);
  } finally { f.db.close(); }
});

it('captures only bounded pin commands at the worker boundary', () => {
  const command = pinCommand('pinRun', uuid(70), uuid(7400));
  expect(command.intentDigest).toBe(pinCommand('pinRun', uuid(70), uuid(7400), scope, '2026-11-14T12:30:00.000Z').intentDigest);
  expect(command.intentDigest).not.toBe(pinCommand('unpinRun', uuid(70), uuid(7400)).intentDigest);
  expect(() => pinCommand('pinRun', 'not-a-run', uuid(7400))).toThrow();
});

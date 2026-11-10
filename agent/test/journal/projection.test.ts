import { DatabaseSync } from 'node:sqlite';
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { validate } from '@beetle/contracts';
import type { ControlEvent, EngineResult } from '@beetle/contracts';
import type { SupervisorInput } from '../../src/journal/index.js';
import { journalFixture } from './fixtures.js';
import { removeFutureRetention } from './legacy-fixtures.js';

const f = journalFixture();
function phase(seq: number, phase: ControlEvent['phase']): ControlEvent { return { ...f.wrapper(seq), phase }; }
function exited(sourceOrdinal: number, observedAt = '2026-01-01T00:00:00Z'): SupervisorInput {
  return { sourceOrdinal, event: { ...f.supervisor().event, kind: 'runtime.exited', observedAt,
    payload: { exitCode: 0, oomKilled: false, observedAt } } };
}
function cancelled(sourceOrdinal: number): SupervisorInput {
  return { sourceOrdinal, event: { ...f.supervisor().event, kind: 'cancellation.requested',
    payload: { requestedAt: '2026-01-01T00:00:00Z' } } };
}
function lost(sourceOrdinal: number): SupervisorInput {
  return { sourceOrdinal, event: { ...f.supervisor().event, kind: 'execution.lost',
    payload: { reason: 'execution_lost', lastObservedAt: '2026-01-01T00:00:00Z' } } };
}
async function result(seq: number): Promise<ControlEvent> {
  const payload = JSON.parse(await readFile('contracts/fixtures/valid/passed-result.json', 'utf8')) as EngineResult;
  payload.artifacts = [{ artifactId: f.key().attemptId, kind: 'report', relativePath: 'report.json', bytes: 1,
    sha256: 'a'.repeat(64), sealedAt: '2026-01-01T00:00:00Z' }];
  const event = { ...phase(seq, 'seal'), kind: 'engine.result', payload } as ControlEvent;
  expect(validate('ControlEvent', event).ok).toBe(true); return event;
}
function inspect<T>(path: string, work: (db: DatabaseSync) => T): T {
  const db = new DatabaseSync(path); try { return work(db); } finally { db.close(); }
}
function dropProjection(db: DatabaseSync, keepResult = false): void {
  removeFutureRetention(db);
  db.exec('DROP TABLE cancelled_originals; DROP TABLE journal_authority; ALTER TABLE accepted_attempts DROP COLUMN checkpoint_bytes; ALTER TABLE accepted_attempts DROP COLUMN wrapper_checkpoint_json; '
    + 'ALTER TABLE accepted_attempts DROP COLUMN snapshot_bytes; ALTER TABLE accepted_attempts DROP COLUMN phase; '
    + 'ALTER TABLE accepted_attempts DROP COLUMN exit_json; ALTER TABLE accepted_attempts DROP COLUMN exit_facts_json;');
  if (!keepResult) db.exec('ALTER TABLE accepted_attempts DROP COLUMN result_json;');
  db.exec("ALTER TABLE supervision_clock DROP COLUMN cancel_reason; ALTER TABLE supervision_clock DROP COLUMN stop_immediate; UPDATE accepted_attempts SET state='admitted'; PRAGMA user_version=4;");
}

describe('durable lifecycle projection', () => {
  it('distinguishes container start from known wrapper phase and never regresses phase', async () => {
    const journal = await f.open(); await journal.immutableOffer(f.offer());
    await journal.appendSupervisor(f.supervisor());
    expect(await journal.get(f.key())).toMatchObject({ state: 'running' });
    expect(await journal.get(f.key())).not.toHaveProperty('phase');
    await journal.appendWrapper(phase(1, 'prepare'));
    await journal.appendSupervisor(f.supervisor(2));
    expect(await journal.get(f.key())).toMatchObject({ state: 'preparing', phase: 'prepare' });
    await journal.appendWrapper(phase(2, 'collect')); await journal.appendSupervisor(f.supervisor(3));
    await journal.appendWrapper(phase(3, 'validate'));
    expect(await journal.get(f.key())).toMatchObject({ state: 'collecting', phase: 'collect' });
  });
  it('requires durable cancel before its event and preserves stopping until actual exit', async () => {
    const journal = await f.open(); await journal.immutableOffer(f.offer());
    await expect(journal.appendSupervisor(cancelled(1))).rejects.toMatchObject({ code: 'conflict' });
    expect(await journal.sourceCursors(f.key())).toEqual({ wrapperSeq: 0, supervisorOrdinal: 0 });
    await journal.durableCancel(f.key()); await journal.appendSupervisor(cancelled(1));
    await journal.appendWrapper(phase(1, 'execute')); await journal.appendSupervisor(f.supervisor(2));
    expect(await journal.get(f.key())).toMatchObject({ state: 'stopping', cancelRequested: true });
    await journal.appendSupervisor(exited(3)); await journal.appendWrapper(phase(2, 'seal'));
    await journal.appendSupervisor(cancelled(4));
    expect(await journal.get(f.key())).toMatchObject({ state: 'exited', phase: 'seal' });
  });
  it('keeps terminal supervisor evidence when delayed wrapper/start/lost events arrive', async () => {
    const journal = await f.open(); await journal.immutableOffer(f.offer()); await journal.appendSupervisor(exited(1));
    await journal.appendWrapper(phase(1, 'prepare')); await journal.appendSupervisor(f.supervisor(2));
    await journal.appendSupervisor(lost(3));
    expect(await journal.get(f.key())).toMatchObject({ state: 'exited', phase: 'prepare', exitEvidence: { exitCode: 0, oomKilled: false } });
  });
  it('retains lost against a delayed start but accepts subsequent actual exit evidence', async () => {
    const journal = await f.open(); await journal.immutableOffer(f.offer()); await journal.appendSupervisor(lost(1));
    await journal.appendSupervisor(f.supervisor(2)); await journal.appendWrapper(phase(1, 'execute'));
    expect(await journal.get(f.key())).toMatchObject({ state: 'lost', phase: 'execute' });
    await journal.appendSupervisor(exited(3)); expect((await journal.get(f.key())).state).toBe('exited');
  });
  it('accepts exit confirmation after restart with a new timestamp, preserving its first witness', async () => {
    const path = f.path(); let journal = await f.open(path); await journal.immutableOffer(f.offer());
    await journal.appendSupervisor(exited(1)); const first = (await journal.get(f.key())).exitEvidence;
    await f.close(journal); journal = await f.open(path);
    await journal.appendSupervisor(exited(2, '2026-01-02T00:00:00Z'));
    expect((await journal.get(f.key())).exitEvidence).toEqual(first);
    const reason = exited(3, '2026-01-03T00:00:00Z');
    if (reason.event.kind !== 'runtime.exited') throw new Error('fixture'); reason.event.payload.reason = 'cancelled';
    await journal.appendSupervisor(reason); expect((await journal.get(f.key())).exitEvidence).toEqual(first);
  });
  it.each(['exitCode', 'oomKilled', 'reason'] as const)('rejects contradictory known %s atomically', async field => {
    const journal = await f.open(); await journal.immutableOffer(f.offer()); const first = exited(1);
    if (first.event.kind !== 'runtime.exited') throw new Error('fixture'); first.event.payload.reason = 'timeout';
    await journal.appendSupervisor(first); const before = await journal.get(f.key()); const changed = exited(2);
    if (changed.event.kind !== 'runtime.exited') throw new Error('fixture'); changed.event.payload.reason = 'timeout';
    Object.assign(changed.event.payload, { [field]: field === 'exitCode' ? 1 : field === 'oomKilled' ? true : 'cancelled' });
    await expect(journal.appendSupervisor(changed)).rejects.toMatchObject({ code: 'conflict' });
    expect(await journal.get(f.key())).toEqual(before); expect((await journal.sourceCursors(f.key())).supervisorOrdinal).toBe(1);
  });
  it.each(['exitCode', 'oomKilled', 'reason'] as const)('remembers refined known %s across unknowns and restart', async field => {
    const path = f.path(); let journal = await f.open(path); await journal.immutableOffer(f.offer());
    const unknown = exited(1);
    if (unknown.event.kind !== 'runtime.exited') throw new Error('fixture');
    unknown.event.payload.exitCode = null; unknown.event.payload.oomKilled = null;
    await journal.appendSupervisor(unknown);
    const confirmed = exited(2);
    if (confirmed.event.kind !== 'runtime.exited') throw new Error('fixture'); confirmed.event.payload.reason = 'timeout';
    await journal.appendSupervisor(confirmed); await journal.appendSupervisor({ ...unknown, sourceOrdinal: 3 });
    await f.close(journal); journal = await f.open(path);
    const changed = structuredClone(confirmed); changed.sourceOrdinal = 4;
    Object.assign(changed.event.payload, { [field]: field === 'exitCode' ? 1 : field === 'oomKilled' ? true : 'cancelled' });
    await expect(journal.appendSupervisor(changed)).rejects.toMatchObject({ code: 'conflict' });
    expect(await journal.get(f.key())).toMatchObject({ lastSeq: 3, exitEvidence: unknown.event.payload });
    expect((await journal.sourceCursors(f.key())).supervisorOrdinal).toBe(3);
    await f.close(journal);
    inspect(path, db => {
      const row = db.prepare('SELECT phase,exit_json,exit_facts_json,result_json,snapshot_bytes FROM accepted_attempts').get()!;
      expect(JSON.parse(String(row.exit_facts_json))).toEqual({ exitCode: 0, oomKilled: false, reason: 'timeout' });
      const charged = ['phase', 'exit_json', 'exit_facts_json', 'result_json'].reduce((sum, key) => sum + Buffer.byteLength(String(row[key] ?? '')), 0);
      expect(row.snapshot_bytes).toBe(charged);
    });
  });
  it('accepts later unknown-fact refinements without rewriting the first exit witness', async () => {
    const journal = await f.open(); await journal.immutableOffer(f.offer()); const first = exited(1);
    if (first.event.kind !== 'runtime.exited') throw new Error('fixture');
    first.event.payload.exitCode = null; first.event.payload.oomKilled = null;
    await journal.appendSupervisor(first); await journal.appendSupervisor(exited(2));
    expect((await journal.get(f.key())).exitEvidence).toEqual(first.event.payload);
  });
});

describe('result retention and projection quota', () => {
  it('keeps exited attempts in lightweight recovery listing with scoped full-result lookup', async () => {
    const journal = await f.open(); await journal.immutableOffer(f.offer()); const event = await result(1);
    await journal.appendWrapper(event); await journal.appendSupervisor(exited(1));
    const page = await journal.listOpen({ limit: 100 });
    expect(page.snapshots[0]).toMatchObject({ state: 'exited', exitEvidence: { exitCode: 0 } });
    expect(page.snapshots[0]).not.toHaveProperty('result');
    expect(await journal.get(f.key())).toMatchObject({ state: 'exited', result: event.payload });
  });
  it('persists engine evidence without inferring runtime exit or application finalization', async () => {
    const path = f.path(); let journal = await f.open(path); await journal.immutableOffer(f.offer());
    const event = await result(1); await journal.appendWrapper(event); const first = await journal.get(f.key());
    expect(first).toMatchObject({ state: 'collecting', phase: 'seal', result: event.payload });
    expect(first).not.toHaveProperty('exitEvidence'); expect(validate('AttemptSnapshot', first).ok).toBe(true);
    const listing = await journal.listOpen({ limit: 100 });
    expect(listing.snapshots[0]).toMatchObject({ state: 'collecting', phase: 'seal', lastSeq: 1 });
    expect(listing.snapshots[0]).not.toHaveProperty('result');
    await journal.acknowledge(f.ack(1)); await journal.prune(f.key());
    await expect(journal.readEvents(f.key(), 0)).rejects.toMatchObject({ code: 'cursor_expired', recovery: { ...first, retainedStartSeq: 2 } });
    await f.close(journal); journal = await f.open(path);
    expect(await journal.get(f.key())).toMatchObject({ result: event.payload, retainedStartSeq: 2 });
    await f.close(journal);
    inspect(path, db => {
      const row = db.prepare('SELECT phase,exit_json,result_json,snapshot_bytes,spool_bytes,spool_rows FROM accepted_attempts').get()!;
      expect(row.spool_bytes).toBe(0); expect(row.spool_rows).toBe(0);
      expect(row.snapshot_bytes).toBe(Buffer.byteLength(String(row.phase)) + Buffer.byteLength(String(row.result_json)));
    });
  });
  it('accepts canonical duplicate result evidence at a new source key and rejects changed content', async () => {
    const journal = await f.open(); await journal.immutableOffer(f.offer()); const event = await result(1);
    await journal.appendWrapper(event);
    await journal.appendWrapper({ ...event, seq: 2, payload: Object.fromEntries(Object.entries(event.payload).reverse()) } as ControlEvent);
    const before = await journal.get(f.key());
    const changed = await result(3); (changed.payload as EngineResult).outcome = 'failed';
    await expect(journal.appendWrapper(changed)).rejects.toMatchObject({ code: 'conflict' });
    expect(await journal.get(f.key())).toEqual(before); expect((await journal.sourceCursors(f.key())).wrapperSeq).toBe(2);
  });
  it.each([0, 1])('admits projection plus event at the exact quota (%s byte short)', async short => {
    const baseline = f.path(); let journal = await f.open(baseline); await journal.immutableOffer(f.offer());
    const event = await result(1); await journal.appendWrapper(event); await f.close(journal);
    const quota = inspect(baseline, db => Number(db.prepare('SELECT spool_bytes+snapshot_bytes AS bytes FROM accepted_attempts').get()?.bytes));
    const path = f.path(); journal = await f.open(path, quota - short); await journal.immutableOffer(f.offer());
    if (short) {
      await expect(journal.appendWrapper(event)).rejects.toMatchObject({ code: 'quota_exceeded' });
      expect(await journal.get(f.key())).toMatchObject({ state: 'offered', lastSeq: 0 });
      expect(await journal.get(f.key())).not.toHaveProperty('result');
    } else {
      await journal.appendWrapper(event); expect(await journal.get(f.key())).toMatchObject({ result: event.payload, lastSeq: 1 });
    }
    await f.close(journal);
    inspect(path, db => {
      const row = db.prepare('SELECT spool_bytes,snapshot_bytes,quota_bytes FROM accepted_attempts').get()!;
      if (short) expect(row).toMatchObject({ spool_bytes: 0, snapshot_bytes: 0 });
      else expect(Number(row.spool_bytes) + Number(row.snapshot_bytes)).toBe(row.quota_bytes);
      expect(() => db.prepare('UPDATE accepted_attempts SET snapshot_bytes=quota_bytes-spool_bytes+1').run()).toThrow();
    });
  });
  it('rolls back event, cursor and projection when its final update fails', async () => {
    const path = f.path(); let journal = await f.open(path); await journal.immutableOffer(f.offer()); await f.close(journal);
    inspect(path, db => db.exec("CREATE TRIGGER injected BEFORE UPDATE OF snapshot_bytes ON accepted_attempts BEGIN SELECT RAISE(ABORT,'fixture'); END;"));
    journal = await f.open(path); await expect(journal.appendWrapper(await result(1))).rejects.toMatchObject({ code: 'unavailable' });
    await journal.abort(); inspect(path, db => db.exec('DROP TRIGGER injected;')); journal = await f.open(path);
    expect(await journal.get(f.key())).toMatchObject({ lastSeq: 0, state: 'offered' });
    expect(await journal.get(f.key())).not.toHaveProperty('result'); expect((await journal.readEvents(f.key(), 0)).events).toEqual([]);
  });
});

describe('additive unpublished journal migration', () => {
  it('preserves v4 events/cursors/ACK and keeps unbackfilled optional evidence unknown', async () => {
    const path = f.path(); let journal = await f.open(path); await journal.immutableOffer(f.offer());
    await journal.appendWrapper(await result(1)); await journal.acknowledge(f.ack(1)); await f.close(journal);
    const before = inspect(path, db => {
      dropProjection(db); return db.prepare('SELECT last_seq,acknowledged_seq,spool_bytes FROM accepted_attempts').get();
    });
    journal = await f.open(path); const recovered = await journal.get(f.key());
    expect(recovered).toMatchObject({ state: 'admitted', lastSeq: 1 });
    for (const field of ['phase', 'exitEvidence', 'result']) expect(recovered).not.toHaveProperty(field);
    expect((await journal.readEvents(f.key(), 0)).events[0]?.kind).toBe('engine.result');
    await f.close(journal);
    inspect(path, db => {
      expect(db.prepare('PRAGMA user_version').get()?.user_version).toBe(12);
      expect(db.prepare('SELECT last_seq,acknowledged_seq,spool_bytes FROM accepted_attempts').get()).toEqual(before);
      expect(db.prepare('SELECT snapshot_bytes FROM accepted_attempts').get()?.snapshot_bytes).toBe(0);
    });
  });
  it('rolls back partial column additions on a late migration failure, preserving old bytes', async () => {
    const path = f.path(); const journal = await f.open(path); await journal.immutableOffer(f.offer());
    await journal.appendWrapper(await result(1)); await f.close(journal);
    const original = inspect(path, db => { dropProjection(db, true); return db.prepare('SELECT result_json FROM accepted_attempts').get()?.result_json; });
    await expect(f.open(path)).rejects.toMatchObject({ code: 'unavailable' });
    inspect(path, db => {
      expect(db.prepare('PRAGMA user_version').get()?.user_version).toBe(4);
      expect(db.prepare('SELECT result_json FROM accepted_attempts').get()?.result_json).toBe(original);
      const names = db.prepare('PRAGMA table_info(accepted_attempts)').all().map(row => row.name);
      expect(names).not.toContain('phase'); expect(names).not.toContain('exit_json'); expect(names).not.toContain('exit_facts_json');
    });
  });
});

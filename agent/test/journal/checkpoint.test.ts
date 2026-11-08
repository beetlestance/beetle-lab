import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { expect, it } from 'vitest';
import type { ControlEvent, EngineResult } from '@beetle/contracts';
import type { WrapperBatch, WrapperCheckpoint } from '../../src/control-protocol/index.js';
import { journalFixture } from './fixtures.js';

const f = journalFixture();
const raw = (events: readonly ControlEvent[]) => events.map(event => JSON.stringify(event) + '\n').join('');
function batch(events: ControlEvent[], expected: WrapperCheckpoint | null = null, prefix = ''): WrapperBatch {
  const bytes = prefix + raw(events);
  return { key: f.key(), expected, next: { version: 1, dev: '18446744073709551615', ino: '9223372036854775809',
    offset: Buffer.byteLength(bytes), wrapperSeq: (expected?.wrapperSeq ?? 0) + events.length,
    prefixSha256: createHash('sha256').update(bytes).digest('hex') }, events };
}
function edit<T>(path: string, operation: (db: DatabaseSync) => T): T {
  const db = new DatabaseSync(path); try { return operation(db); } finally { db.close(); }
}
async function largeFrame(length: number): Promise<ControlEvent> {
  const payload = JSON.parse(await readFile('contracts/fixtures/valid/passed-result.json', 'utf8')) as EngineResult;
  payload.artifacts = Array.from({ length: 100 }, () => ({ artifactId: f.key().attemptId, kind: 'report',
    relativePath: 'a'.repeat(500), bytes: 1, sha256: 'a'.repeat(64), sealedAt: '2026-01-01T00:00:00Z' }));
  const event = { ...f.wrapper(), kind: 'engine.result', payload } as ControlEvent;
  let excess = Buffer.byteLength(JSON.stringify(event)) - length;
  for (const artifact of payload.artifacts) {
    const remove = Math.min(excess, artifact.relativePath.length - 1); artifact.relativePath = artifact.relativePath.slice(remove); excess -= remove;
  }
  expect(excess).toBe(0); expect(Buffer.byteLength(JSON.stringify(event))).toBe(length); return event;
}
it('commits bounded contiguous frames, projection and checkpoint; blocks bypass but keeps supervisor independent', async () => {
  const journal = await f.open(); await journal.immutableOffer(f.offer()); expect(await journal.readWrapperCheckpoint(f.key())).toBeNull();
  const request = batch([f.wrapper(1), f.wrapper(2)]); const checkpoint = await journal.commitWrapperBatch(request);
  expect(checkpoint).toMatchObject(request.next); expect(checkpoint.lastBatchDigest).toMatch(/^[a-f0-9]{64}$/);
  expect(await journal.get(f.key())).toMatchObject({ lastSeq: 2, phase: 'execute' });
  await expect(journal.appendWrapper(f.wrapper(2))).rejects.toMatchObject({ code: 'conflict' });
  await journal.appendSupervisor(f.supervisor()); expect(await journal.readWrapperCheckpoint(f.key())).toEqual(checkpoint);
  const next = batch([f.wrapper(3)], checkpoint, raw(request.events));
  await journal.commitWrapperBatch(next); expect(await journal.sourceCursors(f.key())).toEqual({ wrapperSeq: 3, supervisorOrdinal: 1 });
  expect((await journal.readEvents(f.key(), 0)).events.map(event => event.seq)).toEqual([1, 2, 3, 4]);
});
it('reconciles identical ambiguous replay after pruning and restart, while changed replay conflicts', async () => {
  const path = f.path(); let journal = await f.open(path); await journal.immutableOffer(f.offer());
  const request = batch([f.wrapper()]); const checkpoint = await journal.commitWrapperBatch(request);
  await journal.acknowledge(f.ack(1)); await journal.prune(f.key()); await f.close(journal); journal = await f.open(path);
  expect(await journal.commitWrapperBatch(structuredClone(request))).toEqual(checkpoint);
  const changed = structuredClone(request); changed.events[0]!.observedAt = '2026-01-02T00:00:00Z';
  await expect(journal.commitWrapperBatch(changed)).rejects.toMatchObject({ code: 'conflict' });
  expect(await journal.get(f.key())).toMatchObject({ lastSeq: 1, retainedStartSeq: 2 });
  expect(await journal.readWrapperCheckpoint(f.key())).toEqual(checkpoint);
  await f.close(journal);
  edit(path, db => {
    const row = db.prepare('SELECT checkpoint_bytes,wrapper_checkpoint_json,spool_bytes FROM accepted_attempts').get()!;
    expect(row.checkpoint_bytes).toBe(Buffer.byteLength(String(row.wrapper_checkpoint_json))); expect(row.spool_bytes).toBe(0);
  });
});
it('rejects stale CAS, unadopted legacy stream, wrong scope and stale generation without writes', async () => {
  const journal = await f.open(); await journal.immutableOffer(f.offer()); const first = batch([f.wrapper()]);
  const checkpoint = await journal.commitWrapperBatch(first); const next = batch([f.wrapper(2)], checkpoint, raw(first.events));
  const stale = { ...next, expected: { ...checkpoint, lastBatchDigest: 'a'.repeat(64) } };
  await expect(journal.commitWrapperBatch(stale)).rejects.toMatchObject({ code: 'conflict' });
  await expect(journal.readWrapperCheckpoint({ ...f.key(), generation: 2 })).rejects.toMatchObject({ code: 'stale_generation' });
  await expect(journal.readWrapperCheckpoint({ ...f.key(), workspaceId: '00000000-0000-4000-8000-000000000099' })).rejects.toMatchObject({ code: 'not_found' });
  const legacy = await f.open(); await legacy.immutableOffer(f.offer()); await legacy.appendWrapper(f.wrapper());
  await expect(legacy.commitWrapperBatch(first)).rejects.toMatchObject({ code: 'conflict' });
  expect(await legacy.readWrapperCheckpoint(f.key())).toBeNull(); expect((await journal.get(f.key())).lastSeq).toBe(1);
});
it('rolls back checkpoint, charges, all frames, projection and ordinals when the last frame fails', async () => {
  const path = f.path(); let journal = await f.open(path); await journal.immutableOffer(f.offer()); await f.close(journal);
  edit(path, db => db.exec("CREATE TRIGGER late_fault BEFORE INSERT ON event_spool WHEN NEW.source_key=2 BEGIN SELECT RAISE(ABORT,'fixture'); END;"));
  journal = await f.open(path); await expect(journal.commitWrapperBatch(batch([f.wrapper(1), f.wrapper(2)]))).rejects.toMatchObject({ code: 'unavailable' });
  await journal.abort(); edit(path, db => db.exec('DROP TRIGGER late_fault')); journal = await f.open(path);
  expect(await journal.readWrapperCheckpoint(f.key())).toBeNull(); expect((await journal.get(f.key())).lastSeq).toBe(0);
  expect(await journal.sourceCursors(f.key())).toEqual({ wrapperSeq: 0, supervisorOrdinal: 0 });
  expect((await journal.readEvents(f.key(), 0)).events).toEqual([]); await f.close(journal);
  edit(path, db => expect(db.prepare('SELECT checkpoint_bytes,spool_bytes,snapshot_bytes FROM accepted_attempts').get()).toEqual({ checkpoint_bytes: 0, spool_bytes: 0, snapshot_bytes: 0 }));
});
it.each([0, 1])('charges complete checkpoint replacement with event/projection (%s byte short)', async short => {
  const baseline = f.path(); let journal = await f.open(baseline); await journal.immutableOffer(f.offer()); const request = batch([f.wrapper()]);
  await journal.commitWrapperBatch(request); await f.close(journal);
  const quota = edit(baseline, db => Number(db.prepare('SELECT spool_bytes+snapshot_bytes+checkpoint_bytes AS total FROM accepted_attempts').get()?.total));
  journal = await f.open(undefined, quota - short); await journal.immutableOffer(f.offer());
  if (short) {
    await expect(journal.commitWrapperBatch(request)).rejects.toMatchObject({ code: 'quota_exceeded' });
    expect(await journal.readWrapperCheckpoint(f.key())).toBeNull(); expect((await journal.get(f.key())).lastSeq).toBe(0);
  } else {
    const checkpoint = await journal.commitWrapperBatch(request); expect(checkpoint).toMatchObject(request.next);
    await journal.acknowledge(f.ack(1)); await journal.prune(f.key());
    const next = batch([f.wrapper(2)], checkpoint, raw(request.events));
    expect(await journal.commitWrapperBatch(next)).toMatchObject(next.next);
  }
});
it('accepts the maximum control frame after worst-case agent sequence enrichment and durable replay', async () => {
  const path = f.path(); let journal = await f.open(path); await journal.immutableOffer(f.offer()); await f.close(journal);
  const before = Number.MAX_SAFE_INTEGER - 2;
  edit(path, db => db.prepare('UPDATE accepted_attempts SET last_seq=?,acknowledged_seq=?,retained_start_seq=?,supervisor_high=?,supervisor_expired=?')
    .run(before, before, before + 1, before, before));
  journal = await f.open(path); const event = await largeFrame(65535); const request = batch([event]);
  const checkpoint = await journal.commitWrapperBatch(request); expect(checkpoint.offset).toBe(65536);
  await f.close(journal); journal = await f.open(path);
  const events = (await journal.readEvents(f.key(), before)).events;
  expect(events[0]).toMatchObject({ seq: before + 1, wrapperSeq: 1 });
  expect(Buffer.byteLength(JSON.stringify(events[0]))).toBeGreaterThan(65536);
  expect(Buffer.byteLength(JSON.stringify(events[0]))).toBeLessThanOrEqual(66048);
  expect(await journal.readWrapperCheckpoint(f.key())).toEqual(checkpoint);
});
it('rejects a control frame one byte over its LF-inclusive limit and oversized batch input', async () => {
  const journal = await f.open(); await journal.immutableOffer(f.offer()); const oversized = await largeFrame(65536);
  await expect(journal.commitWrapperBatch(batch([oversized]))).rejects.toMatchObject({ code: 'invalid_input' });
  await expect(journal.appendWrapper(oversized)).rejects.toMatchObject({ code: 'invalid_input' });
  const maximum = await largeFrame(65535);
  const four = Array.from({ length: 4 }, (_, index) => ({ ...structuredClone(maximum), seq: index + 1 }));
  await expect(journal.commitWrapperBatch(batch(four))).rejects.toMatchObject({ code: 'invalid_input' });
  expect(await journal.readWrapperCheckpoint(f.key())).toBeNull(); expect((await journal.get(f.key())).lastSeq).toBe(0);
});

it('rejects multiple new frames with a one-byte cursor advance before any worker effects', async () => {
  const journal = await f.open(); await journal.immutableOffer(f.offer()); const first = batch([f.wrapper()]);
  const checkpoint = await journal.commitWrapperBatch(first);
  const next = batch([f.wrapper(2), f.wrapper(3)], checkpoint, raw(first.events));
  const impossible = { ...next, next: { ...next.next, offset: checkpoint.offset + 1 } };
  await expect(journal.commitWrapperBatch(impossible)).rejects.toMatchObject({ code: 'invalid_input' });
  expect(await journal.readWrapperCheckpoint(f.key())).toEqual(checkpoint);
  expect(await journal.sourceCursors(f.key())).toEqual({ wrapperSeq: 1, supervisorOrdinal: 0 });
  expect((await journal.get(f.key())).lastSeq).toBe(1);
});

import { describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { readFile } from 'node:fs/promises';
import { validate } from '@beetle/contracts';
import type { ControlEvent, EngineResult } from '@beetle/contracts';
import { journalFixture } from './fixtures.js';

const f = journalFixture();
async function largeEvent(seq: number, artifacts = 60): Promise<ControlEvent> {
  const result = JSON.parse(await readFile('contracts/fixtures/valid/passed-result.json', 'utf8')) as EngineResult;
  result.artifacts = Array.from({ length: artifacts }, () => ({ artifactId: f.key().attemptId,
    kind: 'report', relativePath: 'a'.repeat(500), bytes: 1, sha256: 'a'.repeat(64), sealedAt: '2026-01-01T00:00:00Z' }));
  return { ...f.wrapper(seq), kind: 'engine.result', payload: result } as ControlEvent;
}
describe('durable event append and fences', () => {
  it('interleaves independent source ordinals into one authoritative sequence and replays after restart', async () => {
    const path = f.path(); let journal = await f.open(path); await journal.immutableOffer(f.offer());
    const wrapper = await journal.appendWrapper(f.wrapper(8));
    const supervisor = await journal.appendSupervisor(f.supervisor(3));
    const next = await journal.appendWrapper(f.wrapper(9));
    expect([wrapper.seq, supervisor.seq, next.seq]).toEqual([1, 2, 3]);
    expect(wrapper).toMatchObject({ source: 'wrapper', wrapperSeq: 8 });
    expect(supervisor).toMatchObject({ source: 'agent' }); expect(supervisor).not.toHaveProperty('wrapperSeq');
    await f.close(journal); journal = await f.open(path);
    expect(await journal.sourceCursors(f.key())).toEqual({ wrapperSeq: 9, supervisorOrdinal: 3 });
    const batch = await journal.readEvents(f.key(), 0);
    expect(batch.events).toEqual([wrapper, supervisor, next]); expect(batch.nextCursor).toBe(3);
    expect(validate('EventBatch', batch).ok).toBe(true);
    expect(await journal.get(f.key())).toMatchObject({ lastSeq: 3, state: 'offered' });
  });
  it('deduplicates canonical input, rejects changed key reuse and new out-of-order ordinals', async () => {
    const journal = await f.open(); await journal.immutableOffer(f.offer());
    const wrapper = f.wrapper(3); const supervisor = f.supervisor(4);
    const first = await journal.appendWrapper(wrapper); const second = await journal.appendSupervisor(supervisor);
    expect(await journal.appendWrapper(Object.fromEntries(Object.entries(wrapper).reverse()) as ControlEvent)).toEqual(first);
    expect(await journal.appendSupervisor(supervisor)).toEqual(second);
    await expect(journal.appendWrapper({ ...wrapper, observedAt: '2026-01-02T00:00:00Z' })).rejects.toMatchObject({ code: 'conflict' });
    await expect(journal.appendSupervisor({ ...supervisor, event: { ...supervisor.event, observedAt: '2026-01-02T00:00:00Z' } })).rejects.toMatchObject({ code: 'conflict' });
    await expect(journal.appendWrapper(f.wrapper(2))).rejects.toMatchObject({ code: 'expired_key' });
    await expect(journal.appendSupervisor(f.supervisor(2))).rejects.toMatchObject({ code: 'expired_key' });
    expect((await journal.get(f.key())).lastSeq).toBe(2);
  });
  it('rejects wrong scope and stale generation across append/read/ACK/prune/source cursor boundaries', async () => {
    const journal = await f.open(); await journal.immutableOffer(f.offer());
    for (const change of [{ workspaceId: '00000000-0000-4000-8000-000000000099' }, { generation: 2 }]) {
      const code = 'generation' in change ? 'stale_generation' : 'not_found';
      const key = { ...f.key(), ...change };
      const supervisor = f.supervisor();
      for (const operation of [journal.appendWrapper({ ...f.wrapper(), ...change }),
        journal.appendSupervisor({ ...supervisor, event: { ...supervisor.event, ...change } }),
        journal.readEvents(key, 0), journal.acknowledge({ ...f.ack(0), ...change }), journal.prune(key), journal.sourceCursors(key)]) {
        await expect(operation).rejects.toMatchObject({ code });
      }
    }
    expect((await journal.get(f.key())).lastSeq).toBe(0);
  });
  it('preserves schema-valid UUID text verbatim in every output', async () => {
    const journal = await f.open(); const offer = f.offer();
    for (const field of ['attemptId', 'organizationId', 'workspaceId'] as const) offer[field] = `URN:UUID:ABCDEFAB${offer[field].slice(8)}`;
    const key = { attemptId: offer.attemptId, organizationId: offer.organizationId, workspaceId: offer.workspaceId, generation: 1 };
    await journal.immutableOffer(offer);
    expect(await journal.appendWrapper({ ...f.wrapper(), ...key })).toMatchObject(key);
    expect(await journal.readEvents(key, 0)).toMatchObject(key);
    expect(await journal.acknowledge({ ...f.ack(1), ...key })).toMatchObject(key);
    await expect(journal.appendWrapper({ ...f.wrapper(2), ...key, attemptId: key.attemptId.toLowerCase() })).rejects.toMatchObject({ code: 'not_found' });
  });
  it('rejects source spoofing, raw supervisor seq, malformed/oversized input and accessors without advancing sequence', async () => {
    const journal = await f.open(); await journal.immutableOffer(f.offer()); let invoked = false;
    const accessor = Object.defineProperty(f.wrapper(), 'payload', { enumerable: true, get() { invoked = true; throw new Error('CANARY'); } });
    for (const input of [accessor, { ...f.wrapper(), payload: { canary: 'x'.repeat(65536) } }, { ...f.wrapper(), source: 'agent' }, null]) {
      await expect(journal.appendWrapper(input as ControlEvent)).rejects.toMatchObject({ code: 'invalid_input', message: 'Journal invalid_input' });
    }
    const supervisor = f.supervisor();
    await expect(journal.appendSupervisor({ ...supervisor, event: { ...supervisor.event, seq: 1 } } as never)).rejects.toMatchObject({ code: 'invalid_input' });
    await expect(journal.appendSupervisor({ ...supervisor, event: { ...supervisor.event, source: 'wrapper' } } as never)).rejects.toMatchObject({ code: 'invalid_input' });
    expect(invoked).toBe(false); expect((await journal.get(f.key())).lastSeq).toBe(0);
  });
  it('bounds batches by 100 records and 256 KiB including envelope', async () => {
    const journal = await f.open(); await journal.immutableOffer(f.offer());
    for (let seq = 1; seq <= 103; seq++) await journal.appendWrapper(f.wrapper(seq));
    const first = await journal.readEvents(f.key(), 0); expect(first.events).toHaveLength(100);
    expect((await journal.readEvents(f.key(), first.nextCursor)).events).toHaveLength(3);
    const large = await largeEvent(104); expect(validate('ControlEvent', large).ok).toBe(true);
    for (let seq = 104; seq <= 113; seq++) await journal.appendWrapper({ ...large, seq });
    const batch = await journal.readEvents(f.key(), 103);
    expect(Buffer.byteLength(JSON.stringify(batch))).toBeLessThanOrEqual(262144);
    expect(batch.events.length).toBeGreaterThan(0); expect(batch.events.length).toBeLessThan(10);
    expect(batch.events.map(event => event.seq)).toEqual(Array.from({ length: batch.events.length }, (_, index) => index + 104));
  });
  it('rejects nested result identity mismatch and oversized valid envelopes atomically', async () => {
    const journal = await f.open(); await journal.immutableOffer(f.offer());
    const large = await largeEvent(1, 100); expect(validate('ControlEvent', large).ok).toBe(true);
    await expect(journal.appendWrapper(large)).rejects.toMatchObject({ code: 'invalid_input' });
    const nearLimit = await largeEvent(1, 100);
    const artifacts = (nearLimit.payload as EngineResult).artifacts;
    let excess = Buffer.byteLength(JSON.stringify(nearLimit)) - 65520;
    for (const artifact of artifacts) {
      const remove = Math.min(excess, artifact.relativePath.length - 1);
      artifact.relativePath = artifact.relativePath.slice(remove); excess -= remove;
    }
    expect(Buffer.byteLength(JSON.stringify(nearLimit))).toBe(65520);
    expect(validate('ControlEvent', nearLimit).ok).toBe(true);
    await expect(journal.appendWrapper(nearLimit)).rejects.toMatchObject({ code: 'invalid_input' });
    const result = await largeEvent(1, 1);
    const payload = result.payload as EngineResult; payload.workspaceId = '00000000-0000-4000-8000-000000000099';
    await expect(journal.appendWrapper(result)).rejects.toMatchObject({ code: 'conflict' });
    expect((await journal.get(f.key())).lastSeq).toBe(0);
  });
  it('charges persisted bytes and row allowance, rejects overflow without seq growth, and preserves quota after reopen', async () => {
    const path = f.path(); let journal = await f.open(path, 1024); await journal.immutableOffer(f.offer());
    await journal.durableCancel(f.key()); await journal.appendWrapper(f.wrapper());
    await expect(journal.appendWrapper(f.wrapper(2))).rejects.toMatchObject({ code: 'quota_exceeded' });
    expect(await journal.appendWrapper(f.wrapper())).toMatchObject({ seq: 1 });
    await f.close(journal); journal = await f.open(path);
    await expect(journal.appendSupervisor(f.supervisor())).rejects.toMatchObject({ code: 'quota_exceeded' });
    expect(await journal.get(f.key())).toMatchObject({ lastSeq: 1, cancelRequested: true });
    await journal.acknowledge(f.ack(1)); await journal.prune(f.key());
    expect(await journal.appendSupervisor(f.supervisor())).toMatchObject({ seq: 2 });
    await f.close(journal);
    const db = new DatabaseSync(path);
    try {
      const bytes = db.prepare('SELECT sum(charged_bytes) AS total FROM event_spool').get()?.total;
      expect(db.prepare('SELECT spool_bytes,spool_rows,quota_bytes FROM accepted_attempts').get()).toMatchObject({ spool_bytes: bytes, spool_rows: 1, quota_bytes: 1024 });
    } finally { db.close(); }
  });
});

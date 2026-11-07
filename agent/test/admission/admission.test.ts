import { describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import type { AdmissionValue } from '../../src/admission/index.js';
import { configDigest } from '../../src/journal/index.js';
import { admissionFixture, configuration, digest, now, observation, reserved, scope, validation } from './fixtures.js';

const f = admissionFixture();
function reason(value: AdmissionValue): unknown { return value; }
describe('one global transactional pool', () => {
  it('admits cross-org parallel requests within sums and persists one admitted event and original replay', async () => {
    const path = f.path(); let journal = await f.configured(path); const a = f.job(1, 3000); const b = f.job(2, 2000);
    await Promise.all([f.enqueue(journal, a), f.enqueue(journal, b)]);
    const outcomes = await Promise.all([f.admit(journal, a), f.admit(journal, b)]);
    expect(outcomes.filter(item => 'status' in item)).toHaveLength(1);
    expect(reason(outcomes[1]!)).toEqual({ kind: 'defer', reason: 'budget_unavailable' });
    expect(await journal.get(scope(a))).toMatchObject({ state: 'admitted', lastSeq: 1 });
    const events = await journal.readEvents(scope(a), 0);
    expect(events.events).toMatchObject([{ kind: 'admitted', seq: 1, payload: { budget: a.budget } }]);
    expect(await journal.sourceCursors(scope(a))).toEqual({ supervisorOrdinal: 1, wrapperSeq: 0 });
    const first = reserved(outcomes[0]!); await f.close(journal); journal = await f.open(path);
    expect(await f.admit(journal, a, now + 100_000, 99)).toEqual(first);
    expect(await f.enqueue(journal, a)).toEqual(first);
    expect((await journal.readEvents(scope(a), 0)).events).toHaveLength(1);
    await expect(journal.admission({ kind: 'admit', key: { ...scope(a), generation: 2 }, sourceOrdinal: 2, now })).rejects.toMatchObject({ code: 'stale_generation' });
  });
  it('permits two organisations in parallel; isolated holds through unknown collection', async () => {
    const journal = await f.configured(); const a = f.job(1); const b = f.job(2); const c = f.job(3);
    await f.enqueue(journal, a); await f.enqueue(journal, b);
    expect(reserved(await f.admit(journal, a)).status).toBe('charged');
    expect(reserved(await f.admit(journal, b)).status).toBe('charged');
    c.executionPolicy.mode = 'isolated'; await f.enqueue(journal, c);
    expect(await f.admit(journal, c)).toEqual({ kind: 'defer', reason: 'isolated' });
    const other = await f.configured(); await f.enqueue(other, c); await f.admit(other, c);
    await f.enqueue(other, a); expect(await f.admit(other, a)).toEqual({ kind: 'defer', reason: 'isolated' });
  });
  it('drains lowered pools without changing accepted snapshots or reservations', async () => {
    const journal = await f.configured(); const a = f.job(1, 3000); const b = f.job(2);
    await f.enqueue(journal, a); const reservation = await f.admit(journal, a);
    const changed = configuration(); changed.pool.cpuMillis = 2000;
    await journal.admission({ kind: 'configure', configuration: changed });
    await f.enqueue(journal, b);
    expect(await f.admit(journal, b)).toEqual({ kind: 'defer', reason: 'budget_unavailable' });
    expect(await f.admit(journal, a)).toEqual(reservation);
    expect((await journal.readOffer(scope(a))).budget.cpuMillis).toBe(3000);
  });
  it('rolls back reservation, state, sequence, ordinal and queue on event quota overflow', async () => {
    const journal = await f.configured(undefined, 1024); const a = f.job(); await f.enqueue(journal, a);
    await journal.appendSupervisor({ ...f.supervisor(), event: { ...f.supervisor().event, ...scope(a) } });
    await expect(f.admit(journal, a, now, 2)).rejects.toMatchObject({ code: 'quota_exceeded' });
    expect(await journal.get(scope(a))).toMatchObject({ state: 'offered', lastSeq: 1 });
    expect(await journal.admission({ kind: 'reservations', limit: 100 })).toEqual({ reservations: [] });
    expect(await journal.sourceCursors(scope(a))).toEqual({ supervisorOrdinal: 1, wrapperSeq: 0 });
  });
  it('rejects immutable offer or private validation identity conflicts', async () => {
    const journal = await f.configured(); const a = f.job(); await f.enqueue(journal, a);
    await expect(f.enqueue(journal, { ...a, intentDigest: digest })).rejects.toMatchObject({ code: 'conflict' });
    await expect(journal.admission({ kind: 'offer', offer: a, now, validation: { ...validation(a), schemaDigest: 'c'.repeat(64) } })).rejects.toMatchObject({ code: 'conflict' });
    await expect(journal.admission({ kind: 'offer', offer: a, now, validation: { ...validation(a), configDigest: digest } })).rejects.toMatchObject({ code: 'invalid_input' });
  });
});
describe('validation and physical capacity', () => {
  it('bounds config fingerprint input and never invokes an accessor', () => {
    let invoked = false;
    expect(() => configDigest({ get secret() { invoked = true; return 'never'; } })).toThrow();
    expect(invoked).toBe(false);
    expect(() => configDigest({ oversized: 'x'.repeat(1_048_577) })).toThrow();
    expect(configDigest({ a: 1, b: 2 })).toBe(configDigest({ b: 2, a: 1 }));
  });
  it.each([
    ['impossible_request', 5000], ['below_manifest_minimum', 1],
  ])('rejects %s before persisting the Offer', async (expected, cpu) => {
    const journal = await f.configured(); const a = f.job(1, cpu);
    const config = configuration(); config.perRun.cpuMillis = 6000;
    await journal.admission({ kind: 'configure', configuration: config });
    expect(await f.enqueue(journal, a)).toEqual({ kind: 'reject', reason: expected });
    await expect(journal.get(scope(a))).rejects.toMatchObject({ code: 'not_found' });
  });
  it('rejects missing capabilities, controls, timeout ceiling and unsafe byte sums', async () => {
    const journal = await f.configured(); const a = f.job(); a.requiredCapabilities = ['browser'];
    expect(await f.enqueue(journal, a)).toEqual({ kind: 'reject', reason: 'unsupported_capability' });
    a.requiredCapabilities = ['http']; a.budget.timeoutMs = 1001;
    expect(await f.enqueue(journal, a)).toEqual({ kind: 'reject', reason: 'timeout_ceiling' });
    a.budget.timeoutMs = 1000;
    await journal.admission({ kind: 'observe', observation: { ...observation(now + 1), controls: [] } });
    expect(await f.enqueue(journal, a, now + 1)).toEqual({ kind: 'reject', reason: 'controls_unavailable' });
    a.inputs = [{ ...a.inputs[0]!, bytes: Number.MAX_SAFE_INTEGER }, { ...a.inputs[0]!, bytes: 1 }];
    expect(await f.enqueue(journal, a, now + 1)).toEqual({ kind: 'reject', reason: 'impossible_request' });
  });
  it('honors configured disk reserve and headroom in physical free-space checks', async () => {
    const journal = await f.configured(); const config = configuration();
    config.headroom.outputBytes = 1000; config.controlReserve.stagingBytes = 1000;
    await journal.admission({ kind: 'configure', configuration: config });
    await journal.admission({ kind: 'observe', observation: { ...observation(now + 1), freeDiskBytes: 2000 } });
    const a = f.job(); await f.enqueue(journal, a, now + 1);
    expect(await f.admit(journal, a, now + 1)).toEqual({ kind: 'defer', reason: 'disk_unavailable' });
  });
  it('requires fresh runtime and disk observations; unknown remains charged', async () => {
    const path = f.path(); let journal = await f.configured(path); const a = f.job(); const b = f.job(2);
    await f.enqueue(journal, a); await f.admit(journal, a); await f.enqueue(journal, b);
    expect(await f.admit(journal, b, now + 1001)).toEqual({ kind: 'defer', reason: 'capacity_unknown' });
    await journal.admission({ kind: 'observe', observation: { ...observation(now + 1002), status: 'unknown' } });
    expect(await f.admit(journal, b, now + 1002)).toEqual({ kind: 'defer', reason: 'capacity_unknown' });
    await f.close(journal); journal = await f.open(path);
    expect(reserved(await journal.admission({ kind: 'reservation', key: scope(a) })).status).toBe('charged');
    await journal.admission({ kind: 'observe', observation: { ...observation(now + 1003), freeDiskBytes: 100 } });
    expect(await f.admit(journal, b, now + 1003)).toEqual({ kind: 'defer', reason: 'disk_unavailable' });
  });
  it('rolls back a later SQL failure without partially admitting', async () => {
    const path = f.path(); let journal = await f.configured(path); const a = f.job(); await f.enqueue(journal, a); await f.close(journal);
    const db = new DatabaseSync(path); db.exec("CREATE TRIGGER failure BEFORE UPDATE OF state ON accepted_attempts BEGIN SELECT RAISE(ABORT,'synthetic'); END"); db.close();
    journal = await f.open(path); await expect(f.admit(journal, a)).rejects.toMatchObject({ code: 'unavailable' }); await journal.abort();
    const inspect = new DatabaseSync(path);
    try {
      expect(inspect.prepare('SELECT state,last_seq,spool_rows,supervisor_high FROM accepted_attempts').get()).toMatchObject({ state: 'offered', last_seq: 0, spool_rows: 0, supervisor_high: 0 });
      expect(inspect.prepare('SELECT count(*) AS n FROM reservations').get()?.n).toBe(0);
      expect(inspect.prepare('SELECT pending FROM admission_queue').get()?.pending).toBe(1);
    } finally { inspect.close(); }
  });
});

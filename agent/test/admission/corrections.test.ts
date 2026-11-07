import { describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import type { AdmissionValue } from '../../src/admission/index.js';
import { admissionFixture, configuration, digest, now, scope } from './fixtures.js';

const f = admissionFixture();
function token(value: AdmissionValue): string {
  if (!('token' in value)) throw new Error('expected claim'); return value.token;
}
describe('reviewer launch/cancel/minimum/queue regressions', () => {
  it('blocks first create authorization after durable cancel', async () => {
    const journal = await f.configured(); const offer = f.job(); await f.enqueue(journal, offer); await f.admit(journal, offer);
    await journal.durableCancel(scope(offer));
    await expect(journal.admission({ kind: 'claimCreate', key: scope(offer), specDigest: digest })).rejects.toMatchObject({ code: 'conflict' });
  });
  it('permits cleanup binding after cancel but blocks the first start authorization', async () => {
    const journal = await f.configured(); const offer = f.job(); await f.enqueue(journal, offer); await f.admit(journal, offer);
    const createToken = token(await journal.admission({ kind: 'claimCreate', key: scope(offer), specDigest: digest }));
    await journal.durableCancel(scope(offer));
    const binding = { key: scope(offer), specDigest: digest, createToken, runtimeId: 'created' };
    expect(await journal.admission({ kind: 'bindRuntime', ...binding })).toMatchObject({ runtimeId: 'created', status: 'charged' });
    await expect(journal.admission({ kind: 'claimStart', ...binding, now: now + 2 } as never)).rejects.toMatchObject({ code: 'conflict' });
  });
  it('rejects pre-start stopped evidence after a start dispatch has been authorized', async () => {
    const journal = await f.configured(); const offer = f.job(); await f.enqueue(journal, offer); await f.admit(journal, offer);
    const createToken = token(await journal.admission({ kind: 'claimCreate', key: scope(offer), specDigest: digest }));
    const binding = { key: scope(offer), specDigest: digest, createToken, runtimeId: 'created' };
    await journal.admission({ kind: 'bindRuntime', ...binding });
    const evidence = { authority: 'supervisor', ...binding,
      runtime: { state: 'stopped', source: 'supervisor', observedAt: now + 1, evidenceId: 'before-start' },
      collection: { state: 'failed', observedAt: now + 1, evidenceId: 'before-start' } };
    expect(await journal.admission({ kind: 'claimStart', ...binding, now: now + 2 } as never)).toMatchObject({ dispatchAllowed: true });
    await expect(journal.admission({ kind: 'release', evidence } as never)).rejects.toBeDefined();
    expect(await journal.admission({ kind: 'reservation', key: scope(offer) })).toMatchObject({ status: 'charged' });
  });
  it('rejects timeout below an approved minimum before persisting the offer', async () => {
    const journal = await f.configured(); const config = configuration(); Object.assign(config.profiles[0]!.minimum, { timeoutMs: 500 });
    await journal.admission({ kind: 'configure', configuration: config });
    const offer = f.job(); offer.budget.timeoutMs = 1;
    expect(await f.enqueue(journal, offer)).toEqual({ kind: 'reject', reason: 'below_manifest_minimum' });
    await expect(journal.get(scope(offer))).rejects.toMatchObject({ code: 'not_found' });
  });
  it('retires a cancelled pending head before admitting a successor', async () => {
    const journal = await f.configured(); const head = f.job(); const next = f.job(2);
    await f.enqueue(journal, head); await f.enqueue(journal, next); await journal.durableCancel(scope(head));
    expect(await f.admit(journal, next)).toMatchObject({ status: 'charged' });
    expect(await f.enqueue(journal, head)).toEqual({ kind: 'reject', reason: 'cancelled' });
  });
  it('admits timeout equality without adding timeout across parallel reservations', async () => {
    const journal = await f.configured(); const config = configuration(); config.profiles[0]!.minimum.timeoutMs = 500;
    config.maxTimeoutMs = 500; await journal.admission({ kind: 'configure', configuration: config });
    for (const id of [1, 2]) {
      const offer = f.job(id); offer.budget.timeoutMs = 500;
      expect(await f.enqueue(journal, offer)).toEqual({ kind: 'defer', reason: 'queued' });
      expect(await f.admit(journal, offer)).toMatchObject({ status: 'charged', budget: { timeoutMs: 500 } });
    }
    const missing = configuration(); Reflect.deleteProperty(missing.profiles[0]!.minimum, 'timeoutMs');
    await expect(journal.admission({ kind: 'configure', configuration: missing })).rejects.toMatchObject({ code: 'invalid_input' });
  });
  it('recovers the pending cap in the same cancellation transaction', async () => {
    const journal = await f.configured();
    for (let id = 1; id <= 1024; id++) await f.enqueue(journal, f.job(id, 100));
    expect(await f.enqueue(journal, f.job(1025, 100))).toEqual({ kind: 'defer', reason: 'pending_full' });
    await journal.durableCancel(scope(f.job(1, 100)));
    expect(await f.enqueue(journal, f.job(1025, 100))).toEqual({ kind: 'defer', reason: 'queued' });
  }, 15_000);
  it('rolls back cancellation and retirement together on a later SQL failure', async () => {
    const path = f.path(); let journal = await f.configured(path); const offer = f.job(); await f.enqueue(journal, offer); await f.close(journal);
    const inject = new DatabaseSync(path);
    inject.exec("CREATE TRIGGER retire_failure BEFORE UPDATE OF pending ON admission_queue BEGIN SELECT RAISE(ABORT,'synthetic'); END"); inject.close();
    journal = await f.open(path); await expect(journal.durableCancel(scope(offer))).rejects.toMatchObject({ code: 'unavailable' }); await journal.abort();
    const inspect = new DatabaseSync(path);
    try {
      expect(inspect.prepare('SELECT cancel_requested FROM accepted_attempts').get()?.cancel_requested).toBe(0);
      expect(inspect.prepare('SELECT pending,decision_json FROM admission_queue').get()).toMatchObject({ pending: 1, decision_json: null });
    } finally { inspect.close(); }
  });
});

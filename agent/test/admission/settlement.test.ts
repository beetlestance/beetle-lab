import { describe, expect, it } from 'vitest';
import type { AdmissionValue, LaunchSettlement, ReleaseEvidence } from '../../src/admission/index.js';
import type { Journal } from '../../src/journal/index.js';
import { admissionFixture, digest, now, reserved, scope } from './fixtures.js';

const f = admissionFixture();
function claim(value: AdmissionValue): { token: string; dispatchAllowed: boolean } {
  if (!('token' in value)) throw new Error('expected claim'); return value;
}
async function created(journal: Journal, id = 1) {
  const offer = f.job(id); await f.enqueue(journal, offer); await f.admit(journal, offer);
  const result = claim(await journal.admission({ kind: 'claimCreate', key: scope(offer), specDigest: digest }));
  const binding = { key: scope(offer), createToken: result.token, specDigest: digest, runtimeId: `created-${id}` };
  await journal.admission({ kind: 'bindRuntime', ...binding }); return binding;
}
function proof(settlement: LaunchSettlement, at = settlement.settledAt + 1): ReleaseEvidence {
  return { authority: 'supervisor', key: settlement.key, createToken: settlement.createToken,
    specDigest: settlement.specDigest, runtimeId: settlement.runtimeId,
    launch: { epoch: settlement.epoch, startToken: settlement.startToken, settlementId: settlement.evidenceId },
    runtime: { state: 'stopped', source: 'supervisor', observedAt: at, evidenceId: 'stopped' },
    collection: { state: 'failed', observedAt: at, evidenceId: 'collection-failed' } };
}
describe('durable launch quiescence before release', () => {
  it('keeps unknown dispatch charged across restart, then accepts definitive current-token settlement and fresh evidence', async () => {
    const path = f.path(); let journal = await f.configured(path); const binding = await created(journal);
    const started = claim(await journal.admission({ kind: 'claimStart', ...binding, now: now + 10 }));
    const unknown: LaunchSettlement = { authority: 'supervisor', ...binding, epoch: 1, startToken: started.token,
      disposition: 'unknown', settledAt: now + 11, evidenceId: 'unknown-start' };
    await journal.admission({ kind: 'settleLaunch', settlement: unknown });
    expect(reserved(await journal.admission({ kind: 'settleLaunch', settlement: unknown })).launchSettlement).toEqual(unknown);
    await expect(journal.admission({ kind: 'settleLaunch', settlement: { ...unknown, disposition: 'completed' } })).rejects.toMatchObject({ code: 'conflict' });
    await expect(journal.admission({ kind: 'release', evidence: proof(unknown) })).rejects.toMatchObject({ code: 'conflict' });
    await f.close(journal); journal = await f.open(path);
    expect(reserved(await journal.admission({ kind: 'reservation', key: binding.key }))).toMatchObject({ status: 'charged', launchClosed: true });
    expect(claim(await journal.admission({ kind: 'claimStart', ...binding, now: now + 12 }))).toMatchObject({ token: started.token, dispatchAllowed: false });
    const settled: LaunchSettlement = { ...unknown, disposition: 'completed', settledAt: now + 12, evidenceId: 'definitive-start' };
    await journal.admission({ kind: 'settleLaunch', settlement: settled });
    await expect(journal.admission({ kind: 'release', evidence: proof(unknown, now + 13) })).rejects.toMatchObject({ code: 'conflict' });
    expect(reserved(await journal.admission({ kind: 'release', evidence: proof(settled) })).status).toBe('released');
  });
  it('rejects preclaim/pre-settlement and equal-timestamp evidence even with the current settlement reference', async () => {
    const journal = await f.configured(); const binding = await created(journal);
    const started = claim(await journal.admission({ kind: 'claimStart', ...binding, now: now + 10 }));
    const settled: LaunchSettlement = { authority: 'supervisor', ...binding, epoch: 1, startToken: started.token,
      disposition: 'completed', settledAt: now + 12, evidenceId: 'settled' };
    await expect(journal.admission({ kind: 'release', evidence: proof(settled, now + 20) })).rejects.toMatchObject({ code: 'conflict' });
    await journal.admission({ kind: 'settleLaunch', settlement: settled });
    for (const timestamp of [now + 1, now + 10, now + 11, now + 12]) {
      await expect(journal.admission({ kind: 'release', evidence: proof(settled, timestamp) })).rejects.toMatchObject({ code: 'invalid_input' });
    }
    const staleCollection = proof(settled); staleCollection.collection.observedAt = now + 1;
    await expect(journal.admission({ kind: 'release', evidence: staleCollection })).rejects.toMatchObject({ code: 'invalid_input' });
    expect(reserved(await journal.admission({ kind: 'reservation', key: binding.key })).status).toBe('charged');
  });
  it('makes known settlement immutable/idempotent across reopen and rejects late unknown/stale identity', async () => {
    const path = f.path(); let journal = await f.configured(path); const binding = await created(journal);
    const started = claim(await journal.admission({ kind: 'claimStart', ...binding, now: now + 10 }));
    const settled: LaunchSettlement = { authority: 'supervisor', ...binding, epoch: 1, startToken: started.token,
      disposition: 'retired', settledAt: now + 11, evidenceId: 'retired-before-dispatch' };
    const first = await journal.admission({ kind: 'settleLaunch', settlement: settled });
    await f.close(journal); journal = await f.open(path);
    expect(await journal.admission({ kind: 'settleLaunch', settlement: settled })).toEqual(first);
    for (const update of [
      { disposition: 'unknown' as const, settledAt: now + 12 }, { settledAt: now + 10 },
      { startToken: 'different' }, { epoch: 0 as const, startToken: null }, { runtimeId: 'different' },
    ]) await expect(journal.admission({ kind: 'settleLaunch', settlement: { ...settled, ...update } })).rejects.toMatchObject({ code: 'conflict' });
    expect(reserved(await journal.admission({ kind: 'reservation', key: binding.key })).launchSettlement).toEqual(settled);
    expect(reserved(await journal.admission({ kind: 'release', evidence: proof(settled) })).status).toBe('released');
  });
  it('fences every later start before releasing a never-started bound runtime', async () => {
    const path = f.path(); let journal = await f.configured(path); const binding = await created(journal);
    const settlement: LaunchSettlement = { authority: 'supervisor', ...binding, epoch: 0, startToken: null,
      disposition: 'retired', settledAt: now + 1, evidenceId: 'retired-no-start' };
    await journal.admission({ kind: 'settleLaunch', settlement });
    await f.close(journal); journal = await f.open(path);
    await expect(journal.admission({ kind: 'claimStart', ...binding, now: now + 2 })).rejects.toMatchObject({ code: 'conflict' });
    expect(reserved(await journal.admission({ kind: 'reservation', key: binding.key })).status).toBe('charged');
    expect(reserved(await journal.admission({ kind: 'release', evidence: proof(settlement) })).status).toBe('released');
  });
  it('serializes a pre-start settlement racing the first start claim without releasing an outstanding authorization', async () => {
    const journal = await f.configured(); const first = await created(journal);
    const stale: LaunchSettlement = { authority: 'supervisor', ...first, epoch: 0, startToken: null,
      disposition: 'retired', settledAt: now + 1, evidenceId: 'before-start' };
    const startFirst = await Promise.allSettled([journal.admission({ kind: 'claimStart', ...first, now: now + 1 }),
      journal.admission({ kind: 'settleLaunch', settlement: stale })]);
    expect(startFirst[0]).toMatchObject({ status: 'fulfilled', value: { dispatchAllowed: true } });
    expect(startFirst[1]).toMatchObject({ status: 'rejected', reason: { code: 'conflict' } });
    expect(reserved(await journal.admission({ kind: 'reservation', key: first.key })).status).toBe('charged');
    const second = await created(journal, 2);
    const settleFirst = await Promise.allSettled([journal.admission({ kind: 'settleLaunch', settlement: { ...stale, ...second } }),
      journal.admission({ kind: 'claimStart', ...second, now: now + 1 })]);
    expect(settleFirst[0]).toMatchObject({ status: 'fulfilled', value: { launchClosed: true } });
    expect(settleFirst[1]).toMatchObject({ status: 'rejected', reason: { code: 'conflict' } });
  });
  it('rejects malformed or stale settlement boundaries, leaving the launch outstanding', async () => {
    const journal = await f.configured(); const binding = await created(journal);
    await expect(journal.admission({ kind: 'claimStart', ...binding, now: now - 1 })).rejects.toMatchObject({ code: 'invalid_input' });
    const started = claim(await journal.admission({ kind: 'claimStart', ...binding, now: now + 10 }));
    const settlement: LaunchSettlement = { authority: 'supervisor', ...binding, epoch: 1, startToken: started.token,
      disposition: 'unknown', settledAt: now + 9, evidenceId: 'too-old' };
    await expect(journal.admission({ kind: 'settleLaunch', settlement })).rejects.toMatchObject({ code: 'invalid_input' });
    await expect(journal.admission({ kind: 'settleLaunch', settlement: { ...settlement, authority: 'wrapper' } } as never)).rejects.toMatchObject({ code: 'invalid_input' });
    await expect(journal.admission({ kind: 'settleLaunch', settlement: { ...settlement, settledAt: Infinity } })).rejects.toMatchObject({ code: 'invalid_input' });
    expect(reserved(await journal.admission({ kind: 'reservation', key: binding.key }))).toMatchObject({ status: 'charged', launchSettlement: null });
  });
});
describe('cancel and first-claim transaction ordering', () => {
  it('allows only a claim serialized before cancel, and keeps already-created ownership bindable', async () => {
    const journal = await f.configured(); const first = f.job(); const second = f.job(2);
    await f.enqueue(journal, first); await f.admit(journal, first); await f.enqueue(journal, second); await f.admit(journal, second);
    const cancelledFirst = await Promise.allSettled([journal.durableCancel(scope(first)),
      journal.admission({ kind: 'claimCreate', key: scope(first), specDigest: digest })]);
    expect(cancelledFirst[1]).toMatchObject({ status: 'rejected', reason: { code: 'conflict' } });
    const claimFirst = await Promise.all([journal.admission({ kind: 'claimCreate', key: scope(second), specDigest: digest }),
      journal.durableCancel(scope(second))]);
    const create = claim(claimFirst[0]); expect(create.dispatchAllowed).toBe(true);
    expect(claim(await journal.admission({ kind: 'claimCreate', key: scope(second), specDigest: digest })).dispatchAllowed).toBe(false);
    const binding = { key: scope(second), specDigest: digest, createToken: create.token, runtimeId: 'cancelled-created' };
    await journal.admission({ kind: 'bindRuntime', ...binding });
    await expect(journal.admission({ kind: 'claimStart', ...binding, now: now + 1 })).rejects.toMatchObject({ code: 'conflict' });
  });
  it('keeps a start already authorized before cancellation charged until settled', async () => {
    const journal = await f.configured(); const binding = await created(journal);
    const results = await Promise.all([journal.admission({ kind: 'claimStart', ...binding, now: now + 1 }), journal.durableCancel(binding.key)]);
    expect(claim(results[0]).dispatchAllowed).toBe(true);
    expect(claim(await journal.admission({ kind: 'claimStart', ...binding, now: now + 2 })).dispatchAllowed).toBe(false);
    expect(reserved(await journal.admission({ kind: 'reservation', key: binding.key }))).toMatchObject({ status: 'charged', launchSettlement: null });
  });
});

import { describe, expect, it } from 'vitest';
import { validate } from '@beetle/contracts';
import type { AdmissionValue, LaunchSettlement, ReleaseEvidence } from '../../src/admission/index.js';
import { admissionFixture, configuration, digest, now, scope } from './fixtures.js';

const f = admissionFixture();
function claim(value: AdmissionValue): string {
  if (!('token' in value)) throw new Error('expected original claim');
  return value.token;
}
function proof(settlement: LaunchSettlement): ReleaseEvidence {
  return { authority: 'supervisor', key: settlement.key, createToken: settlement.createToken,
    specDigest: settlement.specDigest, runtimeId: settlement.runtimeId,
    launch: { epoch: settlement.epoch, startToken: settlement.startToken, settlementId: settlement.evidenceId },
    runtime: { state: 'stopped', source: 'supervisor', observedAt: settlement.settledAt + 1, evidenceId: 'runtime-canary' },
    collection: { state: 'finished', observedAt: settlement.settledAt + 1, evidenceId: 'collection-canary' } };
}
describe('original durable admission snapshots', () => {
  it('keeps untracked direct Offers absent while queue refusal survives exact replay and reopen without events', async () => {
    const path = f.path(); let journal = await f.configured(path); const job = f.job();
    expect(await journal.immutableOffer(job)).not.toHaveProperty('admission');
    await f.enqueue(journal, job);
    const queued = await journal.get(scope(job));
    expect(queued).toMatchObject({ lastSeq: 0, state: 'offered', admission: { state: 'queued' } });
    const config = configuration(); config.perRun.cpuMillis = 500;
    await journal.admission({ kind: 'configure', configuration: config });
    expect(await f.admit(journal, job)).toEqual({ kind: 'reject', reason: 'per_run_ceiling' });
    const rejected = { ...queued, admission: { state: 'rejected', reason: 'per_run_ceiling' } };
    expect(await journal.get(scope(job))).toEqual(rejected);
    expect(await journal.immutableOffer(job)).toEqual(rejected);
    expect(await f.enqueue(journal, job)).toEqual({ kind: 'reject', reason: 'per_run_ceiling' });
    expect((await journal.readEvents(scope(job), 0)).events).toEqual([]);
    await f.close(journal); journal = await f.open(path);
    expect(await journal.get(scope(job))).toEqual(rejected);
    expect(await journal.immutableOffer(job)).toEqual(rejected);
    expect(await f.enqueue(journal, job)).toEqual({ kind: 'reject', reason: 'per_run_ceiling' });
    expect((await journal.listOpen({ limit: 10 })).snapshots).toEqual([rejected]);
    expect((await journal.prune(scope(job))).snapshot).toEqual(rejected);
    expect(validate('AttemptSnapshot', rejected).ok).toBe(true);
  });
  it('rejects pending cancellation while retaining charged cancellation until original unstarted abort', async () => {
    const journal = await f.configured(); const pending = f.job(); const charged = f.job(2);
    await f.enqueue(journal, charged); await f.admit(journal, charged); await f.enqueue(journal, pending);
    expect(await journal.durableCancel(scope(pending))).toMatchObject({ lastSeq: 0,
      admission: { state: 'rejected', reason: 'cancelled' }, cancelRequested: true });
    expect(await journal.durableCancel(scope(charged))).toMatchObject({ lastSeq: 1,
      admission: { state: 'charged' }, cancelRequested: true });
    const original = await journal.get(scope(charged));
    await journal.admission({ kind: 'abortUnstarted', key: scope(charged) });
    const released = { ...original, admission: { state: 'released', disposition: 'never_started' } };
    expect(await journal.get(scope(charged))).toEqual(released);
    expect(await journal.immutableOffer(charged)).toEqual(released);
    expect(await f.enqueue(journal, pending)).toEqual({ kind: 'reject', reason: 'cancelled' });
    expect((await journal.readEvents(scope(charged), 0)).events).toHaveLength(1);
    expect(await journal.acknowledge({ ...f.ack(1), ...scope(charged) })).toMatchObject({ acknowledgedSeq: 1 });
    await journal.prune(scope(charged));
    await expect(journal.readEvents(scope(charged), 0)).rejects.toMatchObject({ code: 'cursor_expired',
      recovery: { admission: { state: 'released', disposition: 'never_started' } } });
  });
  it('requires definitive original launch settlement and later collection/runtime proof, retaining charged unknown across reopen', async () => {
    const path = f.path(); let journal = await f.configured(path); const job = f.job();
    await f.enqueue(journal, job); await f.admit(journal, job);
    const createToken = claim(await journal.admission({ kind: 'claimCreate', key: scope(job), specDigest: digest }));
    const binding = { key: scope(job), createToken, specDigest: digest, runtimeId: 'private-runtime-canary' };
    await journal.admission({ kind: 'bindRuntime', ...binding });
    const startToken = claim(await journal.admission({ kind: 'claimStart', ...binding, now: now + 1 }));
    await expect(journal.admission({ kind: 'abortUnstarted', key: binding.key })).rejects.toMatchObject({ code: 'conflict' });
    const unknown: LaunchSettlement = { authority: 'supervisor', ...binding, epoch: 1, startToken,
      disposition: 'unknown', settledAt: now + 2, evidenceId: 'launch-canary' };
    await journal.admission({ kind: 'settleLaunch', settlement: unknown });
    await expect(journal.admission({ kind: 'release', evidence: proof(unknown) })).rejects.toMatchObject({ code: 'conflict' });
    await f.close(journal); journal = await f.open(path);
    expect((await journal.get(scope(job))).admission).toEqual({ state: 'charged' });
    const settled: LaunchSettlement = { ...unknown, disposition: 'completed', settledAt: now + 3, evidenceId: 'retired-canary' };
    await journal.admission({ kind: 'settleLaunch', settlement: settled });
    const evidence = proof(settled); evidence.collection.observedAt = settled.settledAt;
    await expect(journal.admission({ kind: 'release', evidence })).rejects.toMatchObject({ code: 'invalid_input' });
    const before = await journal.get(scope(job));
    await journal.admission({ kind: 'release', evidence: proof(settled) });
    const released = { ...before, admission: { state: 'released', disposition: 'settled' } };
    expect(await journal.get(scope(job))).toEqual(released);
    const encoded = JSON.stringify(released);
    for (const privateValue of [createToken, startToken, digest, binding.runtimeId, 'retired-canary', 'collection-canary']) {
      expect(encoded).not.toContain(privateValue);
    }
    await f.close(journal); journal = await f.open(path);
    expect(await journal.get(scope(job))).toEqual(released);
    expect(await journal.immutableOffer(job)).toEqual(released);
    expect(validate('AttemptSnapshot', released).ok).toBe(true);
  });
  it.each(['runtime.exited', 'execution.lost'] as const)('keeps %s lifecycle facts charged without release authority', async kind => {
    const journal = await f.configured(); const job = f.job(); await f.enqueue(journal, job); await f.admit(journal, job);
    const base = { ...f.supervisor(2).event, ...scope(job) };
    const event = kind === 'runtime.exited'
      ? { ...base, kind, payload: { exitCode: 0, oomKilled: false, observedAt: '2026-01-01T00:00:00Z' } }
      : { ...base, kind, payload: { reason: 'execution_lost' as const, lastObservedAt: '2026-01-01T00:00:00Z' } };
    await journal.appendSupervisor({ sourceOrdinal: 2, event });
    expect(await journal.get(scope(job))).toMatchObject({ state: kind === 'runtime.exited' ? 'exited' : 'lost',
      admission: { state: 'charged' } });
  });
});

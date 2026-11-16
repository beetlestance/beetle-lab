import { describe, expect, it } from 'vitest';
import type { AdmissionValue, ReleaseEvidence } from '../../src/admission/index.js';
import type { Journal } from '../../src/journal/index.js';
import { sourceFixture } from '../source-journal/fixtures.js';
import { admissionFixture, digest, now, reserved, scope } from './fixtures.js';

const f = admissionFixture();
const sources = sourceFixture();
function claim(value: AdmissionValue): { token: string; dispatchAllowed: boolean } {
  if (!('token' in value)) throw new Error('expected claim'); return value;
}
async function runtime(journal: Journal, offer = f.job()): Promise<ReleaseEvidence> {
  await f.enqueue(journal, offer); await f.admit(journal, offer);
  const create = claim(await journal.admission({ kind: 'claimCreate', key: scope(offer), specDigest: digest }));
  const binding = { key: scope(offer), specDigest: digest, createToken: create.token, runtimeId: 'synthetic-runtime' };
  await journal.admission({ kind: 'bindRuntime', ...binding });
  await journal.admission({ kind: 'settleLaunch', settlement: { authority: 'supervisor', ...binding,
    epoch: 0, startToken: null, disposition: 'retired', settledAt: now, evidenceId: 'never-started' } });
  return { authority: 'supervisor', ...binding,
    launch: { epoch: 0, startToken: null, settlementId: 'never-started' },
    runtime: { state: 'stopped', source: 'supervisor', observedAt: now + 1, evidenceId: 'stopped-1' },
    collection: { state: 'finished', observedAt: now + 1, evidenceId: 'collection-1' } };
}
describe('durable runtime ownership dispatch fences', () => {
  it('claims create and start once, including replay and unknown outcomes across reopen', async () => {
    const path = f.path(); let journal = await f.configured(path); const a = f.job();
    await f.enqueue(journal, a); await f.admit(journal, a);
    const command = { kind: 'claimCreate' as const, key: scope(a), specDigest: digest };
    const create = claim(await journal.admission(command)); expect(create.dispatchAllowed).toBe(true);
    await f.close(journal); journal = await f.open(path);
    expect(claim(await journal.admission(command))).toMatchObject({ token: create.token, dispatchAllowed: false });
    await expect(journal.admission({ kind: 'abortUnstarted', key: scope(a) })).rejects.toMatchObject({ code: 'conflict' });
    const binding = { key: scope(a), specDigest: digest, createToken: create.token, runtimeId: 'runtime-1' };
    await journal.admission({ kind: 'bindRuntime', ...binding });
    const first = claim(await journal.admission({ kind: 'claimStart', ...binding, now: now + 1 })); expect(first.dispatchAllowed).toBe(true);
    await f.close(journal); journal = await f.open(path);
    expect(claim(await journal.admission({ kind: 'claimStart', ...binding, now: now + 1 }))).toMatchObject({ token: first.token, dispatchAllowed: false });
    expect(reserved(await journal.admission({ kind: 'reservation', key: scope(a) })).status).toBe('charged');
    await expect(journal.admission({ ...command, specDigest: 'c'.repeat(64) })).rejects.toMatchObject({ code: 'conflict' });
    await expect(journal.admission({ kind: 'bindRuntime', ...binding, runtimeId: 'runtime-2' })).rejects.toMatchObject({ code: 'conflict' });
  });
  it('allows durable unstarted abort only before any possible create and fences every later dispatch', async () => {
    const journal = await f.configured(); const a = f.job(); await f.enqueue(journal, a); await f.admit(journal, a);
    const command = { kind: 'abortUnstarted' as const, key: scope(a) };
    expect(reserved(await journal.admission(command))).toMatchObject({ status: 'released', aborted: true });
    expect(reserved(await journal.admission(command)).aborted).toBe(true);
    await expect(journal.admission({ kind: 'claimCreate', key: scope(a), specDigest: digest })).rejects.toMatchObject({ code: 'conflict' });
    await expect(journal.admission({ kind: 'bindRuntime', key: scope(a), specDigest: digest, createToken: 'unknown', runtimeId: 'unknown' })).rejects.toMatchObject({ code: 'conflict' });
    expect(await f.admit(journal, a)).toMatchObject({ status: 'released', aborted: true });
  });
  it('requires an exact persisted create claim and binding before start', async () => {
    const journal = await f.configured(); const a = f.job(); await f.enqueue(journal, a); await f.admit(journal, a);
    const input = { key: scope(a), specDigest: digest, createToken: 'unknown', runtimeId: 'runtime' };
    await expect(journal.admission({ kind: 'bindRuntime', ...input })).rejects.toMatchObject({ code: 'conflict' });
    const create = claim(await journal.admission({ kind: 'claimCreate', key: scope(a), specDigest: digest }));
    await expect(journal.admission({ kind: 'claimStart', ...input, createToken: create.token, now })).rejects.toMatchObject({ code: 'conflict' });
    await expect(journal.admission({ kind: 'claimCreate', key: { ...scope(a), generation: 2 }, specDigest: digest })).rejects.toMatchObject({ code: 'stale_generation' });
    await expect(journal.admission({ kind: 'reservation', key: { ...scope(a), organizationId: f.job(2).organizationId } })).rejects.toMatchObject({ code: 'not_found' });
  });
});
describe('trusted supervisor stopped and collection evidence', () => {
  it('releases finished collection only through its published source receipt and preserves authority across restart', async () => {
    const source = await sources.seed(); let journal = source.journal;
    const evidence = source.collected.release;
    expect(await journal.readOutputSource(source.key)).toBeNull();
    await expect(journal.admission({ kind: 'release', evidence })).rejects.toMatchObject({ code: 'conflict' });
    expect(reserved(await journal.admission({ kind: 'reservation', key: source.key })).status).toBe('charged');
    expect(await journal.beginOutputCollection(source.intent)).toEqual(source.intent);
    const receipt = await journal.commitOutputSource(source.collected);
    expect(await journal.readOutputSource(source.key)).toEqual(source.source);
    await expect(journal.admission({ kind: 'release', evidence })).rejects.toMatchObject({ code: 'conflict' });
    expect(reserved(await journal.admission({ kind: 'reservation', key: source.key })).status).toBe('charged');
    const released = await journal.releaseOutputSource(receipt);
    expect(released).toMatchObject({ status: 'released', releaseEvidence: evidence });
    await sources.close(journal); journal = await sources.open(source.path);
    expect(await journal.journalAuthority()).toBe(source.intent.binding.journalAuthority);
    expect(await journal.readOutputCollection(source.key)).toEqual(source.intent);
    expect(await journal.readOutputSource(source.key)).toEqual(source.source);
    expect(await journal.commitOutputSource(source.collected)).toEqual(receipt);
    expect(await journal.releaseOutputSource(receipt)).toEqual(released);
    expect(await journal.admission({ kind: 'release', evidence })).toEqual(released);
    expect(reserved(await journal.admission({ kind: 'reservation', key: source.key })).releaseEvidence).toEqual(evidence);
    await expect(journal.admission({ kind: 'release', evidence: { ...evidence, runtimeId: 'different' } })).rejects.toMatchObject({ code: 'conflict' });
  });
  it('releases after explicit failed collection and preserves proof across restart', async () => {
    const path = f.path(); let journal = await f.configured(path); const evidence = await runtime(journal);
    evidence.collection.state = 'failed'; evidence.runtime.state = 'absent';
    const released = await journal.admission({ kind: 'release', evidence }); expect(reserved(released).status).toBe('released');
    await f.close(journal); journal = await f.open(path);
    expect(await journal.admission({ kind: 'release', evidence })).toEqual(released);
    expect(reserved(await journal.admission({ kind: 'reservation', key: evidence.key })).releaseEvidence).toEqual(evidence);
    await expect(journal.admission({ kind: 'release', evidence: { ...evidence, runtimeId: 'different' } })).rejects.toMatchObject({ code: 'conflict' });
  });
  it('never releases for ACK, wrapper self report, timeout, wrong runtime/spec/token or incomplete collection', async () => {
    const journal = await f.configured(); const evidence = await runtime(journal); const key = evidence.key;
    await journal.acknowledge({ ...f.ack(1), ...key });
    expect(reserved(await journal.admission({ kind: 'reservation', key })).status).toBe('charged');
    for (const change of [{ runtimeId: 'wrong' }, { specDigest: 'c'.repeat(64) }, { createToken: 'wrong' }]) {
      await expect(journal.admission({ kind: 'release', evidence: { ...evidence, ...change } })).rejects.toMatchObject({ code: 'conflict' });
    }
    const invalid = [
      { ...evidence, authority: 'wrapper' }, { ...evidence, collection: { state: 'running' } },
      { ...evidence, runtime: { ...evidence.runtime, source: 'wrapper' } },
      { ...evidence, runtime: { ...evidence.runtime, state: 'unknown' } },
      { ...evidence, runtime: { ...evidence.runtime, state: 'timeout' } },
    ];
    for (const value of invalid) await expect(journal.admission({ kind: 'release', evidence: value } as never)).rejects.toMatchObject({ code: 'invalid_input' });
    await expect(journal.admission({ kind: 'release', evidence: { ...evidence, key: { ...key, generation: 2 } } })).rejects.toMatchObject({ code: 'stale_generation' });
    expect(reserved(await journal.admission({ kind: 'reservation', key })).status).toBe('charged');
  });
});

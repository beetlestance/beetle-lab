import { DatabaseSync } from 'node:sqlite';
import { expect, it } from 'vitest';
import { captureOutputAbsence } from '@beetle/contracts/output-source';
import { admissionFixture, now, scope } from '../../admission/fixtures.js';
import { releaseOriginal } from '../admission-snapshot-fixtures.js';
import { loseReply } from '../../source-journal/fixtures.js';

const f = admissionFixture();

it('closes zero-event fresh refusal, preserves canonical proof on lost reply/reopen, and allows non-event cancellation', async () => {
  const path = f.path(); let journal = await f.open(path); const offer = f.offer(); const key = scope(offer);
  await journal.cancelOriginal({ offer, now });
  expect((await journal.scanRunnable({ lane: 'delivery', limit: 1 })).attempts).toEqual([key]);
  const proof = await loseReply(journal, () => journal.closeOutputAbsence(key));
  journal = await f.open(path);
  expect(await journal.closeOutputAbsence(key)).toEqual(proof);
  expect(await journal.readOutputAbsence(key)).toEqual(proof);
  expect(captureOutputAbsence(proof)).toMatchObject({ admission: { state: 'rejected', reason: 'cancelled' }, finalAgentSeq: 0 });
  await journal.cancelOriginal({ offer, now: now + 1 });
  await journal.prune(key);
  expect(await journal.readOutputAbsence(key)).toEqual(proof);
  expect((await journal.scanRunnable({ lane: 'delivery', limit: 1 })).attempts).toEqual([]);
});

it('refuses unknown/queued/charged ownership, then derives never-started closure and preserves disk holds through ACK/prune', async () => {
  const path = f.path(); const journal = await f.configured(path); const offer = f.job(); const key = scope(offer);
  await journal.immutableOffer(offer); expect(await journal.closeOutputAbsence(key)).toBeNull();
  await f.enqueue(journal, offer); expect(await journal.closeOutputAbsence(key)).toBeNull();
  await f.admit(journal, offer); expect(await journal.closeOutputAbsence(key)).toBeNull();
  await journal.admission({ kind: 'abortUnstarted', key });
  const proof = await journal.closeOutputAbsence(key);
  expect(proof).toMatchObject({ admission: { state: 'released', disposition: 'never_started' }, reason: 'setup_failed', finalAgentSeq: 1 });
  await journal.acknowledge({ protocolVersion: '1.0', ...key, throughSeq: 1 });
  expect((await journal.prune(key)).pruned).toBe(1);
  await journal.durableCancel(key);
  expect(await journal.readOutputAbsence(key)).toEqual(proof);
  await f.close(journal);
  const db = new DatabaseSync(path, { readOnly: true });
  try { expect(db.prepare('SELECT phase FROM disk_holds').get()?.phase).toBe('retained'); }
  finally { db.close(); }
});

it('derives durable failure diagnostics and rejects wrong scope/generation without accepting caller facts', async () => {
  const journal = await f.configured(); const offer = f.job(); const key = scope(offer);
  await f.enqueue(journal, offer); await f.admit(journal, offer);
  await releaseOriginal(journal, key);
  await journal.supervision({ key, now, cancel: true, reason: 'timeout' });
  expect(await journal.closeOutputAbsence(key)).toMatchObject({ reason: 'timeout', admission: { state: 'released', disposition: 'settled' } });
  await expect(journal.readOutputAbsence({ ...key, organizationId: '00000000-0000-4000-8000-000000000099' }))
    .rejects.toMatchObject({ code: 'not_found' });
  await expect(journal.closeOutputAbsence({ ...key, generation: 2 })).rejects.toMatchObject({ code: 'stale_generation' });
});

it('keeps one bounded delivery cursor over source-free debt, without discovering later arrivals in the original sweep', async () => {
  const journal = await f.open(); const first = f.offer(); const second = { ...f.offer(), attemptId: '00000000-0000-4000-8000-000000000099' };
  await journal.cancelOriginal({ offer: first, now });
  const page = await journal.scanRunnable({ lane: 'delivery', limit: 1 });
  await journal.cancelOriginal({ offer: second, now });
  expect((await journal.scanRunnable({ lane: 'delivery', limit: 1, through: page.through! })).attempts).toEqual([scope(first)]);
  expect((await journal.scanRunnable({ lane: 'delivery', limit: 2 })).attempts).toEqual([scope(first), scope(second)]);
});

it('keeps an actual unknown launch settlement charged and undiscoverable for absence', async () => {
  const journal = await f.configured(); const offer = f.job(); const key = scope(offer);
  await f.enqueue(journal, offer); await f.admit(journal, offer);
  const claim = await journal.admission({ kind: 'claimCreate', key, specDigest: 'b'.repeat(64) });
  if (!('token' in claim)) throw new Error('Missing create claim');
  const binding = { key, createToken: claim.token, runtimeId: 'synthetic-unknown', specDigest: 'b'.repeat(64) };
  await journal.admission({ kind: 'bindRuntime', ...binding });
  await journal.admission({ kind: 'settleLaunch', settlement: { ...binding, authority: 'supervisor', epoch: 0,
    startToken: null, disposition: 'unknown', settledAt: now + 1, evidenceId: 'synthetic-unknown-launch' } });
  expect(await journal.closeOutputAbsence(key)).toBeNull();
  expect((await journal.scanRunnable({ lane: 'delivery', limit: 1 })).attempts).toEqual([]);
});

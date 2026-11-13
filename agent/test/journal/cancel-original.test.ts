import { registeredDatabase } from './registered-db.js';
import { expect, it } from 'vitest';
import { validate } from '@beetle/contracts';
import { admissionFixture, now, scope } from '../admission/fixtures.js';

const f = admissionFixture();
const rejected = { state: 'rejected', reason: 'cancelled' };

it('commits fresh refusal without admission/native facts and retains it across replay, prune and reopen', async () => {
  const path = f.path(); let journal = await f.open(path); const offer = f.offer();
  const authority = await journal.journalAuthority();
  const receipt = await journal.cancelOriginal({ offer, now });
  expect(validate('AttemptSnapshot', receipt).ok).toBe(true);
  expect(receipt).toEqual({ protocolVersion: '1.0', ...scope(offer), intentDigest: offer.intentDigest,
    state: 'offered', lastSeq: 0, retainedStartSeq: 0, cancelRequested: true, admission: rejected });
  const reordered = Object.fromEntries(Object.entries(offer).reverse());
  expect(await journal.cancelOriginal({ offer: reordered, now: now + 1 })).toEqual(receipt);
  expect(await journal.immutableOffer(offer)).toEqual(receipt);
  expect(await journal.readOffer(scope(offer))).toEqual(offer);
  expect(await journal.prune(scope(offer))).toEqual({ pruned: 0, snapshot: receipt });
  expect(await journal.listOpen({ limit: 1 })).toEqual({ snapshots: [receipt] });
  await f.close(journal);
  const db = registeredDatabase(path);
  try {
    expect(db.prepare('SELECT * FROM cancelled_originals').all()).toEqual([{ attempt_id: offer.attemptId, generation: 1 }]);
    for (const table of ['admission_queue', 'reservations', 'event_spool']) {
      expect(db.prepare(`SELECT count(*) AS n FROM ${table}`).get()?.n).toBe(0);
    }
    expect(db.prepare('SELECT cancel_at,cancel_reason FROM supervision_clock').get()).toEqual({ cancel_at: now, cancel_reason: 'cancelled' });
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  } finally { db.close(); }
  journal = await f.open(path);
  expect(await journal.get(scope(offer))).toEqual(receipt);
  expect(await journal.journalAuthority()).toBe(authority);
  expect(await journal.cancelOriginal({ offer, now: now + 2 })).toEqual(receipt);
  expect(await journal.supervision({ key: scope(offer), now: now + 3 })).toMatchObject({ cancelRequestedAt: now, cancelReason: 'cancelled' });
});

it.each(['cancel', 'put'] as const)('serializes racing %s first and never promotes a preexisting unknown receipt', async first => {
  const path = f.path(); const journal = await f.open(path); const offer = f.offer();
  const operations = first === 'cancel'
    ? [journal.cancelOriginal({ offer, now }), journal.immutableOffer(offer)]
    : [journal.immutableOffer(offer), journal.cancelOriginal({ offer, now })];
  const replies = await Promise.all(operations);
  const final = await journal.get(scope(offer));
  expect(final.cancelRequested).toBe(true);
  expect(final.admission).toEqual(first === 'cancel' ? rejected : undefined);
  expect(replies[1]).toEqual(final);
  await f.close(journal);
  const db = registeredDatabase(path);
  try { expect(db.prepare('SELECT count(*) AS n FROM cancelled_originals').get()?.n).toBe(first === 'cancel' ? 1 : 0); }
  finally { db.close(); }
});

it.each(['cancel', 'offer'] as const)('races installed admission Offer with %s first and atomically retires pending work', async first => {
  const path = f.path(); const journal = await f.configured(path); const offer = f.job();
  const operations = first === 'cancel'
    ? [journal.cancelOriginal({ offer, now }), f.enqueue(journal, offer)]
    : [f.enqueue(journal, offer), journal.cancelOriginal({ offer, now })];
  await Promise.all(operations);
  expect((await journal.get(scope(offer))).admission).toEqual(rejected);
  expect(await f.enqueue(journal, offer)).toEqual({ kind: 'reject', reason: 'cancelled' });
  expect(await f.admit(journal, offer)).toEqual({ kind: 'reject', reason: 'cancelled' });
  await expect(journal.admission({ kind: 'claimCreate', key: scope(offer), specDigest: 'b'.repeat(64) }))
    .rejects.toMatchObject({ code: 'not_found' });
  await f.close(journal);
  const db = registeredDatabase(path);
  try {
    expect(db.prepare('SELECT count(*) AS n FROM admission_queue WHERE pending=1').get()?.n).toBe(0);
    expect(db.prepare('SELECT count(*) AS n FROM cancelled_originals').get()?.n).toBe(first === 'cancel' ? 1 : 0);
  } finally { db.close(); }
});

it.each(['cancel', 'admit'] as const)('races %s first against reservation, preserving actual charges and denying create', async first => {
  const journal = await f.configured(); const offer = f.job(); await f.enqueue(journal, offer);
  const operations = first === 'cancel'
    ? [journal.cancelOriginal({ offer, now }), f.admit(journal, offer)]
    : [f.admit(journal, offer), journal.cancelOriginal({ offer, now })];
  await Promise.all(operations);
  expect((await journal.get(scope(offer))).admission).toEqual(first === 'cancel' ? rejected : { state: 'charged' });
  await expect(journal.admission({ kind: 'claimCreate', key: scope(offer), specDigest: 'b'.repeat(64) }))
    .rejects.toMatchObject({ code: first === 'cancel' ? 'not_found' : 'conflict' });
  if (first === 'admit') expect(await journal.admission({ kind: 'reservation', key: scope(offer) })).toMatchObject({ status: 'charged' });
});

it('preserves prior released and rejected facts without creating fresh refusal evidence', async () => {
  const journal = await f.configured(); const released = f.job(); await f.enqueue(journal, released); await f.admit(journal, released);
  await journal.admission({ kind: 'abortUnstarted', key: scope(released) });
  expect((await journal.cancelOriginal({ offer: released, now })).admission).toEqual({ state: 'released', disposition: 'never_started' });
  const queued = f.job(2); await f.enqueue(journal, queued);
  await journal.supervision({ key: scope(queued), now, cancel: true, reason: 'timeout' });
  expect((await journal.cancelOriginal({ offer: queued, now: now + 1 })).admission).toEqual(rejected);
  expect(await journal.supervision({ key: scope(queued), now: now + 2 })).toMatchObject({ cancelReason: 'timeout', cancelRequestedAt: now });
});

it('retains an issued create original through cancellation and late binding without releasing or authorizing start', async () => {
  const path = f.path(); let journal = await f.configured(path); const offer = f.job(); const key = scope(offer);
  await f.enqueue(journal, offer); await f.admit(journal, offer);
  const command = { kind: 'claimCreate' as const, key, specDigest: 'b'.repeat(64) };
  const create = await journal.admission(command);
  if (!('token' in create)) throw new Error('Expected create claim');
  expect(create.dispatchAllowed).toBe(true);
  expect((await journal.cancelOriginal({ offer, now: now + 1 })).admission).toEqual({ state: 'charged' });
  await f.close(journal); journal = await f.open(path);
  expect(await journal.admission(command)).toMatchObject({ token: create.token, dispatchAllowed: false });
  const binding = { key, specDigest: command.specDigest, createToken: create.token, runtimeId: 'synthetic-late-create' };
  expect(await journal.admission({ kind: 'bindRuntime', ...binding })).toMatchObject({ status: 'charged', runtimeId: binding.runtimeId });
  await expect(journal.admission({ kind: 'claimStart', ...binding, now: now + 2 })).rejects.toMatchObject({ code: 'conflict' });
  await expect(journal.admission({ kind: 'abortUnstarted', key })).rejects.toMatchObject({ code: 'conflict' });
  expect((await journal.get(key)).admission).toEqual({ state: 'charged' });
});

it('canonical/scope conflicts leave receipt and first cause unchanged and generation is structurally rejected', async () => {
  const journal = await f.open(); const offer = f.offer(); const initial = await journal.cancelOriginal({ offer, now });
  for (const change of [{ intentDigest: 'b'.repeat(64) }, { config: { changed: true } }]) {
    await expect(journal.cancelOriginal({ offer: { ...offer, ...change }, now: now + 1 })).rejects.toMatchObject({ code: 'conflict' });
  }
  for (const field of ['organizationId', 'workspaceId'] as const) {
    await expect(journal.cancelOriginal({ offer: { ...offer, [field]: '00000000-0000-4000-8000-000000000099' }, now }))
      .rejects.toMatchObject({ code: 'not_found' });
  }
  await expect(journal.cancelOriginal({ offer: { ...offer, generation: 2 }, now })).rejects.toMatchObject({ code: 'invalid_input' });
  expect(await journal.get(scope(offer))).toEqual(initial);
  expect(await journal.supervision({ key: scope(offer), now: now + 2 })).toMatchObject({ cancelRequestedAt: now });
});

it('keeps clock rollback fencing and original first cause/grace through repeated cancellation and reopen', async () => {
  const path = f.path(); let journal = await f.open(path); const offer = f.offer();
  await journal.cancelOriginal({ offer, now });
  await journal.supervision({ key: scope(offer), now: now + 100, cancel: true, reason: 'output_limit' });
  await f.close(journal); journal = await f.open(path);
  await journal.cancelOriginal({ offer, now: now - 1 });
  expect(await journal.supervision({ key: scope(offer), now: now + 200 })).toEqual({ clockHighWater: now + 200,
    clockFenced: true, cancelRequestedAt: now, cancelRequested: true, cancelReason: 'cancelled', immediateStop: true });
});

it('keeps a historical unanchored cancellation unknown without granting new refusal or grace', async () => {
  const path = f.path(); let journal = await f.open(path); const offer = f.offer();
  await journal.immutableOffer(offer); await f.close(journal);
  const db = registeredDatabase(path);
  try { db.exec('UPDATE accepted_attempts SET cancel_requested=1'); } finally { db.close(); }
  journal = await f.open(path);
  expect(await journal.cancelOriginal({ offer, now })).not.toHaveProperty('admission');
  expect(await journal.supervision({ key: scope(offer), now: now + 1 })).toMatchObject({
    clockFenced: true, cancelRequestedAt: null, cancelReason: null });
});

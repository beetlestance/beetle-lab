import { registeredDatabase } from '../journal/registered-db.js';
import { estimateStaging as sharedEstimate, serializeStagedOffer as sharedSerialize } from '@beetle/contracts';
import { expect, it } from 'vitest';
import { estimateStaging, serializeStagedOffer, stagingPolicy, supportedStaging } from '../../src/admission/index.js';
import { admissionFixture, configuration, now, observation, reserved, scope } from './fixtures.js';

const f = admissionFixture();

it('charges exact staged JSON UTF8, all input bytes and explicit metadata bounds', () => {
  const offer = f.job(); offer.secretReferences = []; offer.config.note = '🪲 café';
  const estimate = estimateStaging(offer);
  expect(estimate).toEqual({ policyVersion: 1,
    offerBytes: Buffer.byteLength(serializeStagedOffer(offer)), inputBytes: 1024, secretBytes: 0,
    manifestBytes: 65536, metadataBytes: 65536,
    totalBytes: Buffer.byteLength(serializeStagedOffer(offer)) + 1024 + 131072 });
  expect(supportedStaging(estimate, estimate.totalBytes)).toBe(true);
  expect(Object.isFrozen(estimate)).toBe(true);
});

it.each([0, 1, 16, 64])('reserves secret allowance for %s declared refs without resolving values', count => {
  const offer = f.job();
  offer.secretReferences = Array.from({ length: count }, (_, index) => ({
    name: `name${index}`, provider: 'mounted', reference: `reference${index}` }));
  const estimate = estimateStaging(offer);
  expect(estimate.secretBytes).toBe(Math.min(count * 65536, 1048576));
});

it('rejects unsafe sums and serialization overflow without invoking accessors', () => {
  const offer = f.job(); offer.inputs[0]!.bytes = Number.MAX_SAFE_INTEGER;
  expect(() => estimateStaging(offer)).toThrow('Invalid staging size');
  const oversize = f.job(); oversize.config.content = 'x'.repeat(stagingPolicy.offerBytes);
  expect(() => estimateStaging(oversize)).toThrow();
  let invoked = false; const accessor = f.job();
  Object.defineProperty(accessor.config, 'credential', { enumerable: true, get() { invoked = true; return 'SECRET_VALUE_CANARY'; } });
  expect(() => estimateStaging(accessor)).toThrow(); expect(invoked).toBe(false);
});

it('rejects unknown policy or inconsistent stored charges instead of recomputing', () => {
  const estimate = estimateStaging(f.job());
  expect(supportedStaging(undefined, estimate.totalBytes)).toBe(false);
  expect(supportedStaging({ ...estimate, policyVersion: 2 } as never, estimate.totalBytes)).toBe(false);
  expect(supportedStaging({ ...estimate, inputBytes: -1 }, estimate.totalBytes)).toBe(false);
  expect(supportedStaging({ ...estimate, metadataBytes: 1 }, estimate.totalBytes)).toBe(false);
  expect(supportedStaging(estimate, estimate.totalBytes - 1)).toBe(false);
});

it('pins the staging policy and charge across offer/admission replay and reopen', async () => {
  const path = f.path(); let journal = await f.configured(path); const offer = f.job();
  await f.enqueue(journal, offer); const first = reserved(await f.admit(journal, offer));
  expect(first.staging).toEqual(estimateStaging(offer));
  expect(first.resources.stagingBytes).toBe(first.staging.totalBytes);
  await f.close(journal); journal = await f.open(path);
  expect(await f.enqueue(journal, offer, now + 10)).toEqual(first);
  expect(await f.admit(journal, offer, now + 10)).toEqual(first);
});

it('defers with one byte less free space than staging plus outputs and admits at the bound', async () => {
  const journal = await f.configured(); const offer = f.job(); const estimate = estimateStaging(offer);
  const free = estimate.totalBytes + offer.budget.outputBytes;
  await journal.admission({ kind: 'observe', observation: { ...observation(now + 1), freeDiskBytes: free - 1 } });
  await f.enqueue(journal, offer, now + 1);
  expect(await f.admit(journal, offer, now + 1)).toEqual({ kind: 'defer', reason: 'disk_unavailable' });
  await journal.admission({ kind: 'observe', observation: { ...observation(now + 2), freeDiskBytes: free } });
  expect(await f.admit(journal, offer, now + 2)).toMatchObject({ status: 'charged' });
});

it('includes setup metadata in cross-org staging sums without relaxing production ceilings', async () => {
  const journal = await f.configured(); const a = f.job(); const b = f.job(2);
  const config = configuration();
  config.pool.stagingBytes = estimateStaging(a).totalBytes + estimateStaging(b).totalBytes - 1;
  await journal.admission({ kind: 'configure', configuration: config });
  await f.enqueue(journal, a); await f.admit(journal, a); await f.enqueue(journal, b);
  expect(await f.admit(journal, b)).toEqual({ kind: 'defer', reason: 'budget_unavailable' });
});

it('rejects unpublished pending records missing the cost policy before reserving', async () => {
  const path = f.path(); let journal = await f.configured(path); const offer = f.job(); await f.enqueue(journal, offer);
  await f.close(journal); const db = registeredDatabase(path);
  try { db.exec("UPDATE admission_queue SET candidate_json=json_remove(candidate_json,'$.staging')"); }
  finally { db.close(); }
  journal = await f.open(path);
  expect(await f.admit(journal, offer)).toEqual({ kind: 'reject', reason: 'staging_policy' });
  await expect(journal.admission({ kind: 'reservation', key: scope(offer) })).rejects.toMatchObject({ code: 'not_found' });
});

it('re-exports the shared estimator and serializer without a parallel policy', () => {
  expect(estimateStaging).toBe(sharedEstimate); expect(serializeStagedOffer).toBe(sharedSerialize);
});

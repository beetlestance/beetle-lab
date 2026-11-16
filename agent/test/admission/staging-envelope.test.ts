import { expect, it } from 'vitest';
import { estimateStaging, supportedStaging } from '../../src/admission/index.js';
import { admissionFixture, now, observation, reserved, scope } from './fixtures.js';

const f = admissionFixture();
it('keeps policy1 exact old and full-size charges through pending/charged replay and reopen', async () => {
  const path = f.path(); let journal = await f.configured(path); const old = f.job(); const large = f.job(2);
  large.config = { text: '' }; large.config.text = 'x'.repeat(1048576 - Buffer.byteLength(JSON.stringify(large.config)));
  expect(Buffer.byteLength(JSON.stringify(large.config))).toBe(1048576);
  const oldBytes = Buffer.byteLength(JSON.stringify(old)); const largeBytes = Buffer.byteLength(JSON.stringify(large));
  const charge = (bytes: number) => bytes + 1024 + 65536 + 65536 + 65536;
  await f.enqueue(journal, old); const charged = reserved(await f.admit(journal, old));
  await f.enqueue(journal, large);
  expect(charged.resources.stagingBytes).toBe(charge(oldBytes));
  await f.close(journal); journal = await f.open(path);
  expect(await journal.admission({ kind: 'reservation', key: scope(old) })).toEqual(charged);
  expect(await f.enqueue(journal, old)).toEqual(charged);
  const estimate = estimateStaging(large);
  expect(estimate).toMatchObject({ policyVersion: 1, offerBytes: largeBytes, totalBytes: charge(largeBytes) });
  expect(supportedStaging(charged.staging, charge(oldBytes))).toBe(true);
  expect(supportedStaging(estimate, charge(largeBytes))).toBe(true);
  expect(await journal.readOffer(scope(large))).toEqual(large);
  await journal.admission({ kind: 'observe', observation: observation(now + 1) });
  const admitted = reserved(await f.admit(journal, large, now + 1));
  expect(admitted.resources.stagingBytes).toBe(charge(largeBytes)); expect(admitted.staging).toEqual(estimate);
});
it('rejects over-limit config at admission before durable acceptance or reservation', async () => {
  const journal = await f.configured(); const offer = f.job(); offer.config = { value: 'x'.repeat(1048576) };
  await expect(journal.admission({ kind: 'offer', offer, now: 100000,
    validation: { manifestId: 'k6-v1', profileId: 'locked', schemaDigest: 'b'.repeat(64), configDigest: 'a'.repeat(64), catalogVersion: 1 } }))
    .rejects.toMatchObject({ code: 'invalid_input' });
  expect((await journal.listOpen({ limit: 1 })).snapshots).toEqual([]);
  await expect(journal.admission({ kind: 'reservation', key: scope(offer) })).rejects.toMatchObject({ code: 'not_found' });
});

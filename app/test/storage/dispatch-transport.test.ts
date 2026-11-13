import { expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import type { DispatchKey } from '../../src/ports/dispatch.js';
import type { Offer } from '@beetle/contracts';
import { encodeJson } from '@beetle/contracts';
import { observation, scope, seed, settingsFixture, storageFixture } from './fixture.js';
import { append, createSuite, request } from './suites-fixture.js';
import { runCommand, runOptions } from './runs-fixture.js';
import { snapshotFor } from './execution-foundation-fixtures.js';

const fixture = storageFixture();
function options() {
  const values = settingsFixture();
  values.chain.installation.values.pool.storageBytes = 1_000_000;
  values.runtime.pool.storageBytes = 2_000_000;
  return { installation: values.chain.installation, runtime: observation(values.runtime), ...runOptions() };
}
function nodes(input: unknown): number {
  const pending = [input]; let count = 0;
  while (pending.length) {
    const value = pending.pop(); count++;
    if (value !== null && typeof value === 'object') pending.push(...Object.values(value));
  }
  return count;
}
function nodeConfig(original: Offer): Offer['config'] {
  const config = structuredClone(original.config);
  const arrays: null[][] = Array.from({ length: 16 }, () => []);
  (config.requests as { body?: unknown }[])[0]!.body = { kind: 'json', value: arrays };
  let remaining = 65_536 - nodes({ ...original, config });
  for (const array of arrays) {
    const count = Math.min(4096, remaining); array.push(...Array<null>(count).fill(null)); remaining -= count;
  }
  expect(remaining).toBe(0);
  return config;
}

it('owns scan/read/claim/observe through the compiled worker and preserves replay across reopen', async () => {
  const path = fixture.path(); let metadata = await fixture.open(path, options()); await seed(metadata);
  const revision = await append(metadata, await createSuite(metadata));
  const run = await metadata.runs.execute(runCommand(revision.id));
  const queued = await metadata.dispatch.scan({ lane: 'queued', limit: 1 });
  expect(queued.items[0]).toMatchObject({ order: 1, eligibility: { kind: 'ready' }, key: { runId: run.id } });
  const key = queued.items[0]!.key;
  const original = await metadata.dispatch.readOffer(key);
  expect(original.key).toEqual(key); expect(original.offer.config).toEqual(revision.config);
  const claims = await Promise.all([metadata.dispatch.claim(key), metadata.dispatch.claim(key)]);
  expect(claims.map(value => value.kind)).toEqual(['claimed', 'replay']);
  expect((await metadata.runs.getRun({ scope, id: run.id })).state).toBe('dispatching');
  const observed = await metadata.dispatch.observe({ journalAuthority: '33333333-3333-4333-8333-333333333333', key, snapshot: snapshotFor(key) });
  expect(observed).toMatchObject({ executionCharged: true, runChanged: true, run: { state: 'active', version: 3 } });
  expect(await metadata.dispatch.claim(key)).toEqual({ journalAuthority: '33333333-3333-4333-8333-333333333333', kind: 'acknowledged' });
  expect((await metadata.dispatch.scan({ lane: 'reconcile', limit: 1 })).items[0]?.key).toEqual(key);
  const final = snapshotFor(key, { state: 'exited', lastSeq: 2, admission: { state: 'released', disposition: 'settled' } });
  const released = await metadata.dispatch.observe({ journalAuthority: '33333333-3333-4333-8333-333333333333', key, snapshot: final });
  expect(released).toMatchObject({ executionCharged: false, run: { state: 'finalizing', outcome: 'pending', validationStatus: 'pending' } });
  await fixture.close(metadata);
  const db = new DatabaseSync(path);
  try {
    expect(db.prepare('SELECT count(*) n FROM dispatch_outbox').get()?.n).toBe(0);
    expect(db.prepare('SELECT charged_bytes FROM installation_storage_usage').get()?.charged_bytes)
      .toBe(original.offer.budget.outputBytes + 131_072);
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  } finally { db.close(); }
  metadata = await fixture.open(path, { ...options(), runtime: null, runs: { profiles: [], pendingLimit: 256 } });
  expect(await metadata.dispatch.claim(key)).toEqual({ journalAuthority: '33333333-3333-4333-8333-333333333333', kind: 'acknowledged' });
  expect(await metadata.dispatch.readOffer(key)).toEqual(original);
  expect(await metadata.dispatch.observe({ journalAuthority: '33333333-3333-4333-8333-333333333333', key, snapshot: final })).toEqual({ ...released, runChanged: false });
  expect((await metadata.dispatch.scan({ lane: 'reconcile', limit: 1 })).items).toEqual([]);
});

it('keeps a maximum-node original intact across SQL, worker producer and parent consumer', async () => {
  const metadata = await fixture.open(undefined, options()); await seed(metadata);
  const suite = await createSuite(metadata); const firstRevision = await append(metadata, suite);
  const first = await metadata.runs.execute(runCommand(firstRevision.id));
  const key = (await metadata.dispatch.scan({ lane: 'queued', limit: 1 })).items[0]!.key;
  expect(key.runId).toBe(first.id);
  const template = await metadata.dispatch.readOffer(key);
  const body = request(2); body.config = nodeConfig(template.offer);
  const revision = await append(metadata, suite, 61, body);
  const run = await metadata.runs.execute(runCommand(revision.id, 71));
  const page = await metadata.dispatch.scan({ lane: 'queued', limit: 32 });
  const secondKey = page.items.find(item => item.key.runId === run.id)!.key;
  const result = await metadata.dispatch.readOffer(secondKey);
  expect(nodes(result.offer)).toBe(65_536);
  expect(nodes(result)).toBe(65_545);
  expect(result.offer.config).toEqual(revision.config);
  expect(Buffer.byteLength(encodeJson(result.offer, 2_097_152))).toBeLessThan(2_097_152);
  expect(() => encodeJson(result, 2_162_688)).toThrow('request_limit');
});

it('rejects malformed requests at parent ingress without mutating retained SQL custody', async () => {
  const metadata = await fixture.open(undefined, options()); await seed(metadata);
  const revision = await append(metadata, await createSuite(metadata));
  await metadata.runs.execute(runCommand(revision.id));
  const page = await metadata.dispatch.scan({ lane: 'queued', limit: 1 }); const key = page.items[0]!.key;
  await expect(metadata.dispatch.scan({ lane: 'queued', limit: 33 })).rejects.toMatchObject({ code: 'invalid_input' });
  const invalid = { ...key, attempt: { ...key.attempt, generation: 2 } } as unknown as DispatchKey;
  await expect(metadata.dispatch.claim(invalid)).rejects.toMatchObject({ code: 'invalid_input' });
  await expect(metadata.dispatch.observe({ journalAuthority: '33333333-3333-4333-8333-333333333333', key, snapshot: snapshotFor(key, { intentDigest: 'f'.repeat(64) }) }))
    .rejects.toMatchObject({ code: 'invalid_input' });
  expect(await metadata.dispatch.scan({ lane: 'queued', limit: 1 })).toEqual(page);
  expect(await metadata.dispatch.claim(key)).toEqual({ journalAuthority: '33333333-3333-4333-8333-333333333333', kind: 'claimed', key });
});

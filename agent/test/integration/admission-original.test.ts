import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { expect, it, vi } from 'vitest';
import { Worker } from 'node:worker_threads';
import type { Journal } from '../../src/journal/index.js';
import { configuration, observation, scope } from '../admission/fixtures.js';
import { registration } from '../catalog/fixtures.js';
import { journalFixture } from '../journal/fixtures.js';
import { command, original, sha256, shape } from '../journal/admission-offer-fixtures.js';

const f = journalFixture();
async function configure(journal: Journal): Promise<void> {
  const pool = configuration();
  pool.profiles[0] = { ...pool.profiles[0]!, ...registration().validation };
  await journal.admission({ kind: 'configure', configuration: pool });
  await journal.admission({ kind: 'observe', observation: observation() });
}
it.each(['nodes', 'depth'] as const)('persists exact original %s maximum through compiled journal worker, replay and reopen', async boundary => {
  const job = original(boundary); const request = command(job);
  const expected = JSON.stringify(job); const expectedConfig = JSON.stringify(job.config);
  expect(shape(job)[boundary]).toBe(boundary === 'nodes' ? 65_536 : 64);
  expect(registration().configSchema.validate(job.config)).toBe(true);
  const path = f.path(); let journal = await f.open(path);
  await configure(journal);
  const first = await journal.admission(request);
  expect(first).toEqual({ kind: 'defer', reason: 'queued' });
  expect(await journal.admission(request)).toEqual(first);
  const identity = await journal.get(scope(job));
  expect(identity.admission).toEqual({ state: 'queued' });
  await f.close(journal); journal = await f.open(path);
  const retained = await journal.readOffer(scope(job));
  expect(sha256(JSON.stringify(retained))).toBe(sha256(expected));
  expect(JSON.stringify(retained.config)).toBe(expectedConfig);
  expect(await journal.get(scope(job))).toEqual(identity);
  expect(await journal.admission(request)).toEqual(first);
  const reordered = { ...request, offer: Object.fromEntries(Object.entries(job).reverse()) as typeof job };
  expect(await journal.admission(reordered)).toEqual(first);
  await f.close(journal);
  const db = new DatabaseSync(path);
  try {
    expect(db.prepare('SELECT offer_json FROM accepted_attempts').get()?.offer_json).toBe(expected);
    expect(db.prepare('SELECT count(*) AS count FROM admission_queue').get()?.count).toBe(1);
  } finally { db.close(); }
  expect((await readFile(path)).byteLength).toBeGreaterThan(0);
});

it('shares TWO original credits across admission, immutable Offer and read without posting the third', async () => {
  const journal = await f.open(); await configure(journal);
  const posted = vi.spyOn(Worker.prototype, 'postMessage');
  const job = original('nodes', 4096); const request = command(job);
  try {
    // Calls are synchronous through capture/post: worker responses cannot refund a slot yet.
    const first = journal.immutableOffer(job); const second = journal.admission(request);
    await expect(journal.readOffer(scope(job))).rejects.toMatchObject({ code: 'queue_full' });
    expect(posted.mock.calls.map(([value]) => (value as { kind: string }).kind)).toEqual(['offer', 'admission']);
    await first; await second;
    expect(JSON.stringify(await journal.readOffer(scope(job)))).toBe(JSON.stringify(job));
  } finally { posted.mockRestore(); }
});

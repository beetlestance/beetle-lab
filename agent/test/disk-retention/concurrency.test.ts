import { DatabaseSync } from 'node:sqlite';
import { expect, it } from 'vitest';
import { admissionFixture, configuration, now, observation, reserved, scope } from '../admission/fixtures.js';
import { seedHeldOriginals } from './held-fixtures.js';
import { estimateStaging } from '../../src/admission/index.js';

const f = admissionFixture();
it('serializes two competing last-byte admissions and preserves the winner across abort/lost reply/reopen', async () => {
  const path = f.path(); let journal = await f.configured(path); const old = f.job();
  await f.enqueue(journal, old); const original = reserved(await f.admit(journal, old));
  await journal.admission({ kind: 'abortUnstarted', key: scope(old) });
  const a = f.job(2); const b = f.job(3); const config = configuration();
  config.pool.outputBytes = original.resources.outputBytes + a.budget.outputBytes;
  config.pool.stagingBytes = original.resources.stagingBytes + estimateStaging(a).totalBytes;
  await journal.admission({ kind: 'configure', configuration: config });
  await f.enqueue(journal, a); await f.enqueue(journal, b);
  const result = await Promise.all([f.admit(journal, a), f.admit(journal, b)]);
  expect(result[0]).toMatchObject({ status: 'charged' });
  expect(result[1]).toEqual({ kind: 'defer', reason: 'budget_unavailable' });
  // Discard this successful reply, reopen, then retry the original call.
  await journal.admission({ kind: 'abortUnstarted', key: scope(a) });
  await f.close(journal); journal = await f.open(path);
  expect(await journal.admission({ kind: 'abortUnstarted', key: scope(a) })).toMatchObject({ status: 'released' });
  expect(await f.admit(journal, a)).toMatchObject({ status: 'released' });
  await journal.admission({ kind: 'observe', observation: observation(now + 1) });
  expect(await f.admit(journal, b, now + 1)).toEqual({ kind: 'defer', reason: 'budget_unavailable' });
  await f.close(journal); const db = new DatabaseSync(path, { enableForeignKeyConstraints: true });
  try {
    expect(db.prepare('SELECT * FROM disk_retention_stats').get()).toMatchObject({ held_count: 2,
      held_output_bytes: 200, retained_output_bytes: 200,
      retained_staging_bytes: original.resources.stagingBytes + estimateStaging(a).totalBytes });
    expect(db.prepare('SELECT COUNT(*) AS n FROM disk_holds').get()?.n).toBe(2);
    expect(db.prepare('SELECT SUM(hold_bytes) AS n FROM accepted_attempts').get()?.n).toBe(1024);
  } finally { db.close(); }
});
it('serializes the final native hold slot without a second charge on concurrent replay', async () => {
  const path = f.path(); await seedHeldOriginals(path, 4095);
  const journal = await f.configured(path); const config = configuration();
  config.pool.outputBytes = 1_000_000; config.pool.stagingBytes = 2_000_000_000;
  await journal.admission({ kind: 'configure', configuration: config });
  await journal.admission({ kind: 'observe', observation: { ...observation(now + 1), capacity: config.pool, freeDiskBytes: 3_000_000_000 } });
  const a = f.job(4096); const b = f.job(4097);
  await f.enqueue(journal, a, now + 1); await f.enqueue(journal, b, now + 1);
  const result = await Promise.all([f.admit(journal, a, now + 1), f.admit(journal, b, now + 1), f.admit(journal, a, now + 1)]);
  expect(result[0]).toMatchObject({ status: 'charged' });
  expect(result[1]).toEqual({ kind: 'defer', reason: 'retention_capacity' }); expect(result[2]).toEqual(result[0]);
  await f.close(journal); const observed = new DatabaseSync(path);
  try {
    expect(observed.prepare('SELECT held_count FROM disk_retention_stats').get()?.held_count).toBe(4096);
    expect(observed.prepare('SELECT COUNT(*) AS n FROM disk_holds').get()?.n).toBe(4096);
  } finally { observed.close(); }
}, 20_000);

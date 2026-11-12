import { expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { Worker } from 'node:worker_threads';
import { encodeCanonicalJson } from '@beetle/contracts';
import { HistorySummaries, historyScanSql } from '../../../src/adapters/outbound/sqlite/run-history/index.js';
import { registerHistoryValidation } from '../../../src/adapters/outbound/sqlite/run-history/values.js';
import { storageFixture, settingsFixture, observation } from '../fixture.js';
import { asSchema17, published, summary, scope, uuid } from './fixture.js';
const storage = storageFixture();
it('binds published scalar facts and preserves charges across actual worker commit/replay/reopen', async () => {
  const f = published(); const path = storage.path(); const before = f.usage(); f.db.prepare('VACUUM INTO ?').run(path);
  let metadata = await storage.open(path, { runtime: null, runs: f.config });
  const jobs = await metadata.historySummaries.scan({ nowMs: Date.now(), limit: 1 }); expect(jobs).toHaveLength(1);
  const job = jobs[0]!; const value = summary(job);
  const pending = await metadata.runs.listRuns({ scope, limit: 1 });
  expect(pending.summaries[0]).toMatchObject({ availability: 'pending', retainedLogicalBytes: before, metadataAllowanceBytes: 65536 });
  for (const changed of [{ ...job, attemptId: uuid(98) }, { ...job, sourceDigest: 'f'.repeat(64) },
    { ...job, scope: { ...scope, workspaceId: uuid(98) } }]) {
    await expect(metadata.historySummaries.commit({ job: changed, summary: value })).rejects.toThrow();
  }
  await expect(metadata.historySummaries.commit({ job, summary: { ...value, source: { ...value.source!, numericSha256: 'f'.repeat(64) } } })).rejects.toMatchObject({ code: 'conflict' });
  expect(await metadata.historySummaries.commit({ job, summary: value })).toEqual(value);
  expect(await metadata.historySummaries.commit({ job, summary: JSON.parse(encodeCanonicalJson(value, 2048)) as typeof value })).toEqual(value);
  const page = await metadata.runs.listRuns({ scope, limit: 1 });
  expect(page.summaries[0]).toEqual({ ...value, retainedLogicalBytes: before, metadataAllowanceBytes: 65536 });
  expect(await metadata.historySummaries.scan({ nowMs: Date.now(), limit: 16 })).toEqual([]);
  expect((await metadata.inputs.storage()).chargedBytes).toBe(before);
  await expect(metadata.historySummaries.commit({ job, summary: { ...value, requestCount: 5, requestsPerSecond: 2.5 } })).rejects.toMatchObject({ code: 'conflict' });
  await storage.close(metadata); metadata = await storage.open(path, { runtime: null, runs: f.config });
  expect((await metadata.runs.listRuns({ scope, limit: 1 })).summaries).toEqual(page.summaries);
});
it('migrates retained v17 rows and uses the exact indexed due scan with replay-safe deferral', async () => {
  const f = published();
  asSchema17(f.db);
  const path = storage.path(); f.db.prepare('VACUUM INTO ?').run(path);
  const metadata = await storage.open(path, { runtime: null, runs: f.config });
  const [job] = await metadata.historySummaries.scan({ nowMs: 1000, limit: 1 }); expect(job).toBeDefined();
  await metadata.historySummaries.defer({ job: job!, dueMs: 2000 });
  await metadata.historySummaries.defer({ job: job!, dueMs: 2000 });
  expect(await metadata.historySummaries.scan({ nowMs: 1999, limit: 1 })).toEqual([]);
  expect((await metadata.historySummaries.scan({ nowMs: 2000, limit: 1 }))[0]?.expectedDueMs).toBe(2000);
  await expect(metadata.historySummaries.commit({ job: job!, summary: summary(job!) })).rejects.toMatchObject({ code: 'conflict' });
  await storage.close(metadata); const db = new DatabaseSync(path);
  const plan = db.prepare('EXPLAIN QUERY PLAN ' + historyScanSql).all(2000, 16).map(row => row.detail).join(' ');
  expect(plan).toContain('run_history_due'); expect(plan).not.toContain('TEMP B-TREE'); expect(plan).not.toContain('SCAN r');
  expect(db.prepare('PRAGMA user_version').get()?.user_version).toBe(18);
  expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]); db.close();
});
it('rejects forged or mutable raw SQL projections without changing accounting', () => {
  const f = published(); const histories = new HistorySummaries(f.db);
  const [job] = histories.execute({ kind: 'historySummary', operation: { method: 'scan', query: { nowMs: Date.now(), limit: 1 } } }) as Parameters<typeof summary>[0][];
  const value = summary(job!); const before = f.usage();
  const update = (v: unknown) => f.db.prepare('UPDATE runs SET history_summary_json=? WHERE id=?').run(JSON.stringify(v), job!.id);
  expect(() => update({ ...value, extra: 'x' })).toThrow();
  expect(() => update({ ...value, source: { ...value.source!, manifestDigest: 'f'.repeat(64) } })).toThrow();
  expect(() => update({ ...value, publishedArtifactBytes: 33 })).toThrow();
  expect(() => update({ ...value, retainedLogicalBytes: 0 })).toThrow();
  update(value); expect(() => update({ ...value, availability: 'unavailable', source: null })).toThrow();
  expect(f.usage()).toBe(before);
});
it('recovers a discarded successful compiled-worker reply without another projection or credit', async () => {
  const f = published(); const path = storage.path(); f.db.prepare('VACUUM INTO ?').run(path);
  const histories = new HistorySummaries(f.db);
  const [job] = histories.execute({ kind: 'historySummary', operation: { method: 'scan', query: { nowMs: Date.now(), limit: 1 } } }) as Parameters<typeof summary>[0][];
  const value = summary(job!);
  const worker = new Worker(storage.workerUrl(), { workerData: { path, bootstrap: { installation: settingsFixture().chain.installation, runtime: observation(), runs: f.config } } });
  try {
    await new Promise<void>((resolve, reject) => {
      worker.once('error', reject); worker.on('message', (message: { kind: string; ok?: boolean }) => {
        if (message.kind === 'ready') worker.postMessage({ kind: 'historySummary', operation: { method: 'commit', request: { job, summary: value } }, messageId: 1 });
        else if (message.kind === 'result' && message.ok) resolve(); else reject(new Error('Worker did not commit derivative'));
      });
    });
  } finally { await worker.terminate(); }
  const metadata = await storage.open(path, { runtime: null, runs: f.config });
  expect(await metadata.historySummaries.commit({ job: job!, summary: value })).toEqual(value);
  expect((await metadata.inputs.storage()).chargedBytes).toBe(f.usage());
  await storage.close(metadata); const db = new DatabaseSync(path); registerHistoryValidation(db);
  expect(db.prepare('SELECT count(*) n FROM runs WHERE history_summary_json IS NOT NULL').get()?.n).toBe(1);
  expect(db.prepare('SELECT count(*) n FROM execution_output_finalizations').get()?.n).toBe(1); db.close();
});

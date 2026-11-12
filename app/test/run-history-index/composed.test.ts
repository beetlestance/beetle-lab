import { expect, it, vi } from 'vitest';
import { openApplication } from '../../src/bootstrap/api.js';
import type { Application } from '../../src/bootstrap/api.js';
import { createRunMetricsService } from '../../src/application/run-metrics/index.js';
import { startRunHistoryIndexer } from '../../src/application/run-history-index/index.js';
import { storageFixture, settingsFixture } from '../storage/fixture.js';
import { fixture as filesFixture } from '../files/output-bytes/fixture.js';
import { nativeFixture } from '../run-metrics/native-fixture.js';
import { fixture as metricFixture, digest, rewrite } from '../run-metrics/fixture.js';
import { client, value } from '../bootstrap/run-fixture.js';
const storage = storageFixture();
it('carries real published bytes through one verified projection, compiled worker and public application reads/reopen', async () => {
  const f = await nativeFixture(filesFixture, async () => {
    const source = await metricFixture(); rewrite(source, 'numeric-final', text => {
      const numeric = JSON.parse(text); numeric.version = 4; numeric.timing = { testRunDurationMs: 2000 };
      numeric.metrics.totals.push({ metric: 'http_reqs', kind: 'counter', scope: 'execute', tags: { phase: 'execute', request: 'r0' }, total: { kind: 'counter', sum: 8 } });
      return JSON.stringify(numeric);
    }); return source;
  });
  const path = storage.path(); f.db.prepare('VACUUM INTO ?').run(path);
  const metadata = await storage.open(path, { runtime: null, runs: f.config });
  const bytes = vi.fn(f.files.store.read.bind(f.files.store));
  const metrics = createRunMetricsService({ artifacts: metadata.runArtifacts, bytes: { read: bytes }, createDigest: digest });
  const onFailure = vi.fn(async () => undefined); const index = startRunHistoryIndexer({ store: metadata.historySummaries, metrics, onFailure, intervalMs: 25 });
  let app: Application | undefined;
  try {
    const scope = f.source.query.scope; const params = { organizationId: scope.organizationId, workspaceId: scope.workspaceId };
    await vi.waitFor(async () => expect((await metadata.runs.listRuns({ scope, limit: 1 })).summaries[0]?.availability).toBe('ready'), { timeout: 5000, interval: 50 });
    const stored = (await metadata.runs.listRuns({ scope, limit: 1 })).summaries[0]!;
    expect(stored).toMatchObject({ testDurationMs: 2000, requestCount: 8, requestsPerSecond: 4, source: { numericVersion: 4 } });
    expect(stored.httpP95?.source).toBe('histogram-estimate'); expect(stored.retainedLogicalBytes).toBe(f.usage());
    expect(onFailure).not.toHaveBeenCalled(); const nativeReads = bytes.mock.calls.length;
    expect(nativeReads).toBeGreaterThan(0); await index.close(); await metrics.close(); await storage.close(metadata);
    const options = { externalOrigin: 'http://127.0.0.1:43179', metadata: { path, workerUrl: storage.workerUrl(),
      installation: settingsFixture().chain.installation, runtime: null, runs: f.config } };
    app = await openApplication(options); const paired = await client(app);
    expect(app.historySummaryState()).toBe('disabled');
    const page = value(await paired.api.listRuns({ params, query: { limit: 1 } })); expect(page.summaries).toEqual([stored]);
    expect(value(await paired.api.listRuns({ params, query: { limit: 1, order: 'oldest', state: 'finished' } })).summaries).toEqual([stored]);
    expect(bytes).toHaveBeenCalledTimes(nativeReads);
    await app.close(); app = await openApplication(options); const reopened = await client(app);
    expect(value(await reopened.api.listRuns({ params, query: { limit: 1 } })).summaries).toEqual([stored]);
    expect(bytes).toHaveBeenCalledTimes(nativeReads);
  } finally {
    await app?.close(); await index.close(); await metrics.close(); await f.files.dispose();
  }
});

import { expect, it } from 'vitest';
import { createRunMetricsService } from '../../../src/application/run-metrics/index.js';
import { deferred } from '../../files/output-bytes/fixture.js';
import { context, digest } from '../../run-metrics/fixture.js';
import { nativeFixture } from '../../run-metrics/native-fixture.js';
import { httpFixture } from './fixture.js';

it('admits one overview behind a chart, keeps one physical original and refuses a third HTTP request', async () => {
  const f = await nativeFixture();
  const chartEntered = deferred();
  const overviewEntered = deferred();
  const releaseChart = deferred();
  let originals = 0;
  const service = createRunMetricsService({
    artifacts: {
      ...f.reader,
      async listRunArtifacts(query) {
        if (++originals === 1) {
          chartEntered.resolve();
          await releaseChart.promise;
        }
        return f.reader.listRunArtifacts(query);
      },
    },
    bytes: f.files.store,
    createDigest: digest,
  });
  let http: Awaited<ReturnType<typeof httpFixture>> | undefined;
  const params = {
    organizationId: f.key.attempt.organizationId,
    workspaceId: f.key.attempt.workspaceId,
    runId: f.key.runId,
    attemptId: f.key.attempt.attemptId,
  };
  try {
    http = await httpFixture({
      ...service,
      reader: {
        ...service.reader,
        getRunMetricOverview(query, context) {
          overviewEntered.resolve();
          return service.reader.getRunMetricOverview(query, context);
        },
      },
    });
    const chart = http.client.getRunChartHistory({ params });
    await chartEntered.promise;
    const overview = http.client.getRunMetricOverview({ params });
    expect(await Promise.race([overviewEntered.promise.then(() => 'waiting'), overview.then(() => 'finished')])).toBe(
      'waiting',
    );
    const key = {
      id: params.runId,
      scope: { kind: 'workspace' as const, organizationId: params.organizationId, workspaceId: params.workspaceId },
      attemptId: params.attemptId,
    };
    await expect(service.reader.getRunChartHistory(key, context())).rejects.toMatchObject({ code: 'busy' });
    const extra = await http.client.listRunMetricSeries({ params, query: { limit: 1 } });
    expect(extra).toMatchObject({ ok: false, error: { status: 503, protocol: { code: 'capacity_unavailable' } } });
    expect(originals).toBe(1);

    releaseChart.resolve();
    expect(await chart).toMatchObject({ ok: true, value: { reason: null, windows: 3 } });
    expect(await overview).toMatchObject({
      ok: true,
      value: { availability: 'ready', endpoints: [{ request: 'r0' }] },
    });
    expect(originals).toBe(2);
  } finally {
    releaseChart.resolve();
    try {
      await http?.close();
    } finally {
      await service.close();
      await f.files.dispose();
    }
  }
});

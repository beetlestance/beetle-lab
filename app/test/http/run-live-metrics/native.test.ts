import { expect, it, vi } from 'vitest';
import type { RunMetricsService } from '../../../src/ports/run-metrics.js';
import type { RunLiveMetricsService } from '../../../src/ports/run-live-metrics.js';
import { frame, deferred } from '../../run-live-metrics/fixtures.js';
import { httpFixture } from '../run-metrics/fixture.js';
const history: RunMetricsService = {
  readRunHistorySummary: async () => {
    throw new Error('Unexpected synthetic history indexing');
  },
  lookupRunMetricSeries: async () => {
    throw new Error('Unexpected metric lookup');
  },
  reader: {
    listRunMetricSeries: async () => {
      throw new Error('unused');
    },
    getRunMetricSamples: async () => {
      throw new Error('unused');
    },
    getRunLatencyAttribution: async () => {
      throw new Error('unused');
    },
  },
  close: async () => {},
};
it('bounds public response lifetime to five seconds while retaining both ignored-abort originals through shutdown', async () => {
  const gate = deferred<Awaited<ReturnType<RunLiveMetricsService['reader']['getRunLiveMetrics']>>>();
  const getRunLiveMetrics = vi.fn<RunLiveMetricsService['reader']['getRunLiveMetrics']>(() => gate.promise);
  const service: RunLiveMetricsService = { reader: { getRunLiveMetrics }, close: async () => {} };
  const http = await httpFixture(history, service);
  const params = {
    organizationId: '00000000-0000-4000-8000-000000000001',
    workspaceId: '00000000-0000-4000-8000-000000000002',
    runId: '00000000-0000-4000-8000-000000000005',
    attemptId: '00000000-0000-4000-8000-000000000006',
  };
  const start = performance.now();
  const clients = [http.client.getRunLiveMetrics({ params }), http.client.getRunLiveMetrics({ params })];
  let closing: Promise<void> | undefined;
  try {
    await expect.poll(() => getRunLiveMetrics.mock.calls.length).toBe(2);
    expect(await http.client.getRunLiveMetrics({ params })).toMatchObject({ ok: false, error: { status: 503 } });
    expect((await Promise.all(clients)).every((result) => !result.ok)).toBe(true);
    expect(performance.now() - start).toBeGreaterThanOrEqual(4500);
    expect(performance.now() - start).toBeLessThan(7000);
    expect(getRunLiveMetrics.mock.calls.every(([, owner]) => owner.signal.aborted)).toBe(true);
    let closed = false;
    closing = http.close().then(() => {
      closed = true;
    });
    await new Promise((resolve) => setImmediate(resolve));
    expect(closed).toBe(false);
  } finally {
    gate.resolve({
      frame: frame({
        scope: {
          organizationId: params.organizationId,
          workspaceId: params.workspaceId,
          attemptId: params.attemptId,
          generation: 1,
        },
      }),
      freshUntilMonotonicMs: performance.now() + 6000,
      observedMonotonicMs: performance.now(),
    });
    await closing;
    await http.close();
  }
});

it.each(['valid', 'expired', 'invalid'] as const)(
  'carries only a valid remaining freshness budget over real HTTP: %s',
  async (kind) => {
    const getRunLiveMetrics: RunLiveMetricsService['reader']['getRunLiveMetrics'] = async () => {
      const now = performance.now();
      return {
        frame: frame({
          scope: {
            organizationId: '00000000-0000-4000-8000-000000000001',
            workspaceId: '00000000-0000-4000-8000-000000000002',
            attemptId: '00000000-0000-4000-8000-000000000006',
            generation: 1,
          },
        }),
        freshUntilMonotonicMs: kind === 'invalid' ? NaN : now + (kind === 'expired' ? -1 : 5000),
        observedMonotonicMs: now,
      };
    };
    const http = await httpFixture(history, { reader: { getRunLiveMetrics }, close: async () => {} });
    try {
      const response = await fetch(
        http.origin +
          '/api/v2/organizations/00000000-0000-4000-8000-000000000001/workspaces/00000000-0000-4000-8000-000000000002/runs/00000000-0000-4000-8000-000000000005/attempts/00000000-0000-4000-8000-000000000006/metrics/live',
        { headers: http.headers },
      );
      expect(response.status).toBe(kind === 'valid' ? 200 : 503);
      const header = response.headers.get('x-beetle-live-fresh-for-ms');
      if (kind === 'valid') {
        expect(Number(header)).toBeGreaterThan(0);
        expect(Number(header)).toBeLessThanOrEqual(5000);
        expect(await response.json()).toMatchObject({ scope: { attemptId: '00000000-0000-4000-8000-000000000006' } });
      } else {
        expect(header).toBeNull();
        await response.arrayBuffer();
      }
    } finally {
      await http.close();
    }
  },
);

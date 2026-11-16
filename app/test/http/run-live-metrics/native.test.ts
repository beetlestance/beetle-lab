import { expect, it, vi } from 'vitest';
import type { RunMetricsService } from '../../../src/ports/run-metrics.js';
import type { RunLiveMetricsService } from '../../../src/ports/run-live-metrics.js';
import { frame, deferred } from '../../run-live-metrics/fixtures.js';
import { httpFixture } from '../run-metrics/fixture.js';
const history: RunMetricsService = {readRunHistorySummary: async () => { throw new Error('Unexpected synthetic history indexing'); }, lookupRunMetricSeries: async () => {throw new Error('Unexpected metric lookup');},reader: {listRunMetricSeries: async () => {throw new Error('unused');},
  getRunMetricSamples: async () => {throw new Error('unused');}}, close: async () => {}};
it('bounds public response lifetime to five seconds while retaining both ignored-abort originals through shutdown', async () => {
  const gate = deferred<ReturnType<typeof frame>>();
  const getRunLiveMetrics = vi.fn<RunLiveMetricsService['reader']['getRunLiveMetrics']>(() => gate.promise);
  const service: RunLiveMetricsService = {reader: {getRunLiveMetrics}, close: async () => {}};
  const http = await httpFixture(history, service);
  const params = {organizationId: '00000000-0000-4000-8000-000000000001', workspaceId: '00000000-0000-4000-8000-000000000002',
    runId: '00000000-0000-4000-8000-000000000005', attemptId: '00000000-0000-4000-8000-000000000006'};
  const start = performance.now();
  const clients = [http.client.getRunLiveMetrics({params}), http.client.getRunLiveMetrics({params})];
  let closing: Promise<void> | undefined;
  try {
    await expect.poll(() => getRunLiveMetrics.mock.calls.length).toBe(2);
    expect(await http.client.getRunLiveMetrics({params})).toMatchObject({ok: false, error: {status: 503}});
    expect((await Promise.all(clients)).every(result => !result.ok)).toBe(true);
    expect(performance.now() - start).toBeGreaterThanOrEqual(4500);
    expect(performance.now() - start).toBeLessThan(7000);
    expect(getRunLiveMetrics.mock.calls.every(([, owner]) => owner.signal.aborted)).toBe(true);
    let closed = false; closing = http.close().then(() => {closed = true;});
    await new Promise(resolve => setImmediate(resolve)); expect(closed).toBe(false);
  } finally {gate.resolve(frame({scope: {organizationId: params.organizationId, workspaceId: params.workspaceId, attemptId: params.attemptId, generation: 1}})); await closing; await http.close();}
});

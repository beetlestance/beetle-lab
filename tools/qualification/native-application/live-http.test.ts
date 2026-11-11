import { expect, it, vi } from 'vitest';
import { createAgentServer } from '../../../agent/src/transport/index.js';
import { createRunnerGateway } from '../../../app/src/adapters/outbound/runner/index.js';
import { createRunLiveMetricsService } from '../../../app/src/application/run-live-metrics/index.js';
import { RunExecutions } from '../../../app/src/adapters/outbound/sqlite/execution-binding/index.js';
import type { RunMetricsService } from '../../../app/src/ports/run-metrics.js';
import { frame, hash } from '../../../app/test/run-live-metrics/fixtures.js';
import { fixture, keyFor, uuid } from '../../../app/test/run-results/fixture.js';
import { loaded } from '../../../app/test/runner/fixtures.js';
import { httpFixture } from '../../../app/test/http/run-metrics/fixture.js';
const history: RunMetricsService = {reader: {listRunMetricSeries: async () => {throw new Error('unused');},
  getRunMetricSamples: async () => {throw new Error('unused');}}, close: async () => {}};
it('carries a scoped live frame through actual private agent HTTP, gateway, SQL binding and authenticated public TCP', async () => {
  const f = fixture(); f.observe({state: 'running', phase: 'execute', lastSeq: 2});
  const key = keyFor(f.key.runId); const read = vi.fn(async () => {
    const now = Date.now(); const {organizationId, workspaceId, attemptId, generation} = f.key.attempt;
    return {ok: true as const, frame: frame({scope: {organizationId, workspaceId, attemptId, generation},
      capturedAtMs: now, publishedAtMs: now, startTimeMs: now - 1000, endTimeMs: now})};
  });
  const unused = async (): Promise<never> => {throw new Error('unused');};
  const agent = createAgentServer({credential: 'S'.repeat(64), journalAuthority: f.binding.journalAuthority,
    installation: {enqueue: unused, cancel: unused, cancelOriginal: unused},
    journal: {get: unused, readEvents: unused, acknowledge: unused}, capabilities: unused, liveMetrics: read});
  await agent.listen({host: '127.0.0.1', port: 0}); const address = agent.server.address();
  if (!address || typeof address === 'string') throw new Error('missing private loopback');
  const connection = loaded(`http://127.0.0.1:${address.port}`); const gateway = createRunnerGateway({...connection, token: 'S'.repeat(64)});
  const service = createRunLiveMetricsService({executions: {getRunExecution: async key => new RunExecutions(f.db, f.reads).get(key)}, gateway, hash});
  let http: Awaited<ReturnType<typeof httpFixture>> | undefined;
  try {
    http = await httpFixture(history, service); const before = f.facts();
    const params = {organizationId: key.scope.organizationId, workspaceId: key.scope.workspaceId, runId: key.id, attemptId: f.key.attempt.attemptId};
    const result = await http.client.getRunLiveMetrics({params});
    expect(result, JSON.stringify({run: f.reads.get(key).state, remoteCalls: read.mock.calls.length, result})).toMatchObject({ok: true}); if (result.ok) expect(result.value.scope.attemptId).toBe(params.attemptId);
    expect(read).toHaveBeenCalledTimes(1); expect(f.facts()).toEqual(before);
    const url = `${http.origin}/api/v2/organizations/${params.organizationId}/workspaces/${params.workspaceId}/runs/${params.runId}/attempts/${params.attemptId}/metrics/live`;
    expect((await fetch(url)).status).toBe(401);
    expect((await fetch(url + '?path=anything', {headers: http.headers})).status).toBe(400);
    const foreign = await http.client.getRunLiveMetrics({params: {...params, workspaceId: uuid(999)}});
    expect(foreign).toMatchObject({ok: false, error: {kind: 'protocol', status: 404}}); expect(read).toHaveBeenCalledTimes(1);
    f.observe({state: 'exited', phase: 'execute', lastSeq: 3});
    expect(await http.client.getRunLiveMetrics({params})).toMatchObject({ok: false, error: {kind: 'protocol', status: 503}});
    expect(read).toHaveBeenCalledTimes(1);
  } finally {
    try {await http?.close();} finally {try {await service.close(); await gateway.close();} finally {await agent.close();}}
  }
});

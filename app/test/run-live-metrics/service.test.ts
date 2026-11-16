import { expect, it, vi } from 'vitest';
import { createRunLiveMetricsService } from '../../src/application/run-live-metrics/index.js';
import { RunExecutions } from '../../src/adapters/outbound/sqlite/execution-binding/index.js';
import type { RunExecutionReader, RunExecutionSnapshot, RunnerLiveMetricGateway } from '../../src/ports/run-live-metrics.js';
import type { ClientResult } from '@beetle/contracts';
import type { LiveMetricSnapshot } from '@beetle/contracts/api';
import { frame, hash, deferred } from './fixtures.js';
import { fixture, keyFor, uuid } from '../run-results/fixture.js';
function setup() {
  const f = fixture(); const key = keyFor(f.key.runId);
  const base = new RunExecutions(f.db, f.reads).get(key); const snapshot: RunExecutionSnapshot = {...base, run: {...base.run, state: 'active'}};
  const read = vi.fn<RunExecutionReader['getRunExecution']>(async () => snapshot);
  const now = Date.now(); const {organizationId, workspaceId, attemptId, generation} = f.key.attempt;
  const value = frame({scope: {organizationId, workspaceId, attemptId, generation},
    capturedAtMs: now, publishedAtMs: now, startTimeMs: now - 1000, endTimeMs: now});
  const remote = vi.fn<RunnerLiveMetricGateway['liveMetrics']>(async () => ({ok: true, value}));
  let wall = now;
  const service = createRunLiveMetricsService({executions: {getRunExecution: read}, gateway: {liveMetrics: remote}, hash, wall: () => wall});
  return {read, remote, service, value, snapshot, setWall: (value: number) => {wall = value;}, query: {...key, attemptId},
    context: () => ({signal: new AbortController().signal, deadline: performance.now() + 5000})};
}
it('resolves and rechecks exact durable authority around one remote read', async () => {
  const e = setup();
  expect(await e.service.reader.getRunLiveMetrics(e.query, e.context())).toEqual(e.value);
  expect(e.read).toHaveBeenCalledTimes(2); expect(e.read).toHaveBeenCalledWith({id: e.query.id, scope: e.query.scope}); expect(e.remote).toHaveBeenCalledTimes(1);
  expect(e.remote.mock.calls[0]![0]).toEqual({...e.snapshot.binding!.key.attempt, journalAuthority: e.snapshot.binding!.journalAuthority});
  await e.service.close();
});
it.each(['scope', 'attempt', 'terminal', 'unbound', 'cancelled'] as const)('refuses unsafe current owner before network I/O: %s', async cause => {
  const e = setup(); let copy = structuredClone(e.snapshot);
  if (cause === 'scope') copy.run.scope.workspaceId = uuid(999);
  if (cause === 'attempt') copy.run.activeAttemptId = uuid(999);
  if (cause === 'terminal') copy.run.state = 'finished';
  if (cause === 'unbound') copy = {...copy, binding: null};
  if (cause === 'cancelled') copy.run.cancellationRequested = true;
  e.read.mockResolvedValue(copy);
  await expect(e.service.reader.getRunLiveMetrics(e.query, e.context())).rejects.toThrow();
  expect(e.remote).not.toHaveBeenCalled(); await e.service.close();
});
it('rejects a reply after run completion or physical authority change', async () => {
  const e = setup(); const changed = structuredClone(e.snapshot); changed.run.state = 'finished';
  e.read.mockResolvedValueOnce(e.snapshot).mockResolvedValueOnce(changed);
  await expect(e.service.reader.getRunLiveMetrics(e.query, e.context())).rejects.toThrow();
  const authority = {...e.snapshot, binding: {...e.snapshot.binding!, journalAuthority: uuid(999)}};
  e.read.mockResolvedValueOnce(e.snapshot).mockResolvedValueOnce(authority);
  await expect(e.service.reader.getRunLiveMetrics(e.query, e.context())).rejects.toThrow(); await e.service.close();
});
it('retains two original reads after caller abort and drains them on close', async () => {
  const e = setup(); const gate = deferred<ClientResult<LiveMetricSnapshot>>(); e.remote.mockImplementation(() => gate.promise);
  const abort = new AbortController(); const one = e.service.reader.getRunLiveMetrics(e.query, {...e.context(), signal: abort.signal});
  const two = e.service.reader.getRunLiveMetrics(e.query, e.context());
  const firstFailure = expect(one).rejects.toThrow(); const secondFailure = expect(two).rejects.toThrow();
  await expect.poll(() => e.remote.mock.calls.length).toBe(2); abort.abort(); await firstFailure;
  await expect(e.service.reader.getRunLiveMetrics(e.query, e.context())).rejects.toMatchObject({code: 'busy'});
  let closed = false; const closing = e.service.close().then(() => {closed = true;});
  await secondFailure; expect(closed).toBe(false);
  gate.resolve({ok: true, value: e.value}); await closing;
  expect(e.read).toHaveBeenCalledTimes(2);
});
it('does not issue remote work after an aborted original metadata read finally settles', async () => {
  const e = setup(); const gate = deferred<typeof e.snapshot>(); e.read.mockImplementation(() => gate.promise);
  const abort = new AbortController(); const read = e.service.reader.getRunLiveMetrics(e.query, {...e.context(), signal: abort.signal});
  const failure = expect(read).rejects.toThrow(); await expect.poll(() => e.read.mock.calls.length).toBe(1);
  abort.abort(); await failure; const closing = e.service.close(); gate.resolve(e.snapshot); await closing;
  expect(e.remote).not.toHaveBeenCalled();
});

it.each(['stale', 'rollback'] as const)('rechecks freshness after the final metadata original: %s', async cause => {
  const e = setup();
  e.read.mockResolvedValueOnce(e.snapshot).mockImplementationOnce(async () => {
    e.setWall(e.value.capturedAtMs + (cause === 'stale' ? 6001 : -1)); return e.snapshot;
  });
  await expect(e.service.reader.getRunLiveMetrics(e.query, e.context())).rejects.toThrow();
  expect(e.remote).toHaveBeenCalledTimes(1); await e.service.close();
});

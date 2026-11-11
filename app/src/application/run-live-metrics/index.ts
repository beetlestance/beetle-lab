import { encodeCanonicalJson, encodeJson } from '@beetle/contracts';
import { captureLiveMetricSnapshot, liveMetricScopeMatches, validateApi } from '@beetle/contracts/api';
import type { LiveMetricHash, LiveMetricSnapshot } from '@beetle/contracts/api';
import type { RunExecutionReader, RunExecutionSnapshot, RunLiveMetricQuery, RunLiveMetricsService,
  RunnerLiveMetricGateway } from '../../ports/run-live-metrics.js';
import type { MetricReadContext } from '../../ports/run-metrics.js';
import { MetricReadError } from '../../ports/run-metrics.js';
import { captureEventBinding } from '../../domain/events/index.js';
import { SemanticError } from '../../domain/namespaces/index.js';
import { MetricReadOperation } from '../metric-read-lifetime/index.js';
interface Options {executions: RunExecutionReader; gateway?: Pick<RunnerLiveMetricGateway, 'liveMetrics'>; hash: LiveMetricHash; wall?(): number}
function querySnapshot(input: unknown): RunLiveMetricQuery {
  const q = JSON.parse(encodeJson(input, 4096)) as RunLiveMetricQuery;
  if (!q || Object.keys(q).sort().join(',') !== 'attemptId,id,scope'
    || !validateApi('WorkspaceScope', q.scope).ok || !validateApi('RunAttemptParams', {organizationId: q.scope.organizationId,
      workspaceId: q.scope.workspaceId, runId: q.id, attemptId: q.attemptId}).ok) throw new SemanticError('invalid_value');
  return {id: q.id.toLowerCase(), attemptId: q.attemptId.toLowerCase(), scope: {kind: 'workspace',
    organizationId: q.scope.organizationId.toLowerCase(), workspaceId: q.scope.workspaceId.toLowerCase()}};
}
function currentExecution(input: RunExecutionSnapshot, q: RunLiveMetricQuery) {
  const copy = JSON.parse(encodeJson(input, 16384)) as RunExecutionSnapshot;
  if (!validateApi('Run', copy.run).ok || copy.run.id !== q.id || copy.run.scope.organizationId !== q.scope.organizationId
    || copy.run.scope.workspaceId !== q.scope.workspaceId || copy.run.activeAttemptId !== q.attemptId) throw new MetricReadError('unavailable');
  if (copy.run.state !== 'active' || copy.run.cancellationRequested || !copy.binding) throw new MetricReadError('unavailable');
  return copy;
}
function authority(input: RunExecutionSnapshot, q: RunLiveMetricQuery) {
  const copy = currentExecution(input, q);
  const binding = captureEventBinding(copy.binding); const attempt = binding.key.attempt;
  if (binding.key.runId !== q.id || attempt.organizationId !== q.scope.organizationId
    || attempt.workspaceId !== q.scope.workspaceId || attempt.attemptId !== q.attemptId) throw new MetricReadError('unavailable');
  return binding;
}
function assertFresh(frame: LiveMetricSnapshot, expected: LiveMetricSnapshot['scope'], start: number, now: number): void {
  if (!liveMetricScopeMatches(frame.scope, expected) || !Number.isSafeInteger(start) || !Number.isSafeInteger(now) || now < start
    || [frame.capturedAtMs, frame.publishedAtMs, frame.endTimeMs].some(time => time > now || now - time > 6000)) throw new MetricReadError('unavailable');
}
/** Two finite originals; no corpus, background loop, mutation or retry. */
export function createRunLiveMetricsService(options: Options): RunLiveMetricsService {
  const read = options.executions.getRunExecution.bind(options.executions);
  const remote = options.gateway?.liveMetrics.bind(options.gateway); const hash = options.hash; const wall = options.wall ?? Date.now;
  const active = new Map<MetricReadOperation, Promise<unknown>>(); let closed = false; let closing: Promise<void> | undefined;
  async function capture(q: RunLiveMetricQuery, owner: MetricReadOperation): Promise<LiveMetricSnapshot> {
    owner.check(); const before = authority(await read({id: q.id, scope: q.scope}), q); owner.check();
    if (!remote) throw new MetricReadError('unavailable');
    const start = wall(); const result = await remote({...before.key.attempt, journalAuthority: before.journalAuthority}, owner.signal); owner.check();
    if (!result.ok) throw new MetricReadError('unavailable');
    const frame = captureLiveMetricSnapshot(result.value, hash);
    const expected = {...before.key.attempt};
    assertFresh(frame, expected, start, wall());
    const after = authority(await read({id: q.id, scope: q.scope}), q); owner.check();
    if (encodeCanonicalJson(after, 1024) !== encodeCanonicalJson(before, 1024)) throw new MetricReadError('unavailable');
    assertFresh(frame, expected, start, wall());
    return frame;
  }
  return Object.freeze({reader: Object.freeze({getRunLiveMetrics(input: RunLiveMetricQuery, context: MetricReadContext) {
    if (closed || active.size >= 2) return Promise.reject(new MetricReadError(closed ? 'closed' : 'busy'));
    let q: RunLiveMetricQuery; let owner: MetricReadOperation;
    try {q = querySnapshot(input); owner = new MetricReadOperation(context, 5000);} catch (error) {return Promise.reject(error);}
    const original = Promise.resolve().then(() => capture(q, owner)).finally(() => {owner.dispose(); active.delete(owner);});
    active.set(owner, original); return owner.race(original);
  }}), close() {
    closed = true;
    for (const owner of active.keys()) owner.controller.abort();
    closing ??= Promise.allSettled([...active.values()]).then(() => undefined); return closing;
  }});
}

import { encodeJson } from '@beetle/contracts';
import { validateApi } from '@beetle/contracts/api';
import type { RunExecutionSnapshot, RunLiveMetricQuery } from '../../ports/run-live-metrics.js';
import { MetricReadError } from '../../ports/run-metrics.js';
import { captureEventBinding } from '../../domain/events/index.js';
import { SemanticError } from '../../domain/namespaces/index.js';
export function captureLiveAttemptQuery(input: unknown): RunLiveMetricQuery {
  const q = JSON.parse(encodeJson(input, 4096)) as RunLiveMetricQuery;
  if (
    !q ||
    Object.keys(q).sort().join(',') !== 'attemptId,id,scope' ||
    !validateApi('WorkspaceScope', q.scope).ok ||
    !validateApi('RunAttemptParams', {
      organizationId: q.scope.organizationId,
      workspaceId: q.scope.workspaceId,
      runId: q.id,
      attemptId: q.attemptId,
    }).ok
  )
    throw new SemanticError('invalid_value');
  return {
    id: q.id.toLowerCase(),
    attemptId: q.attemptId.toLowerCase(),
    scope: {
      kind: 'workspace',
      organizationId: q.scope.organizationId.toLowerCase(),
      workspaceId: q.scope.workspaceId.toLowerCase(),
    },
  };
}
function currentExecution(input: RunExecutionSnapshot, q: RunLiveMetricQuery) {
  const copy = JSON.parse(encodeJson(input, 16384)) as RunExecutionSnapshot;
  if (
    !validateApi('Run', copy.run).ok ||
    copy.run.id !== q.id ||
    copy.run.scope.organizationId !== q.scope.organizationId ||
    copy.run.scope.workspaceId !== q.scope.workspaceId ||
    copy.run.activeAttemptId !== q.attemptId
  )
    throw new MetricReadError('unavailable');
  if (copy.run.state !== 'active' || copy.run.cancellationRequested || !copy.binding)
    throw new MetricReadError('unavailable');
  return copy;
}
export function captureLiveAttemptBinding(input: RunExecutionSnapshot, q: RunLiveMetricQuery) {
  const copy = currentExecution(input, q);
  const binding = captureEventBinding(copy.binding);
  const attempt = binding.key.attempt;
  if (
    binding.key.runId !== q.id ||
    attempt.organizationId !== q.scope.organizationId ||
    attempt.workspaceId !== q.scope.workspaceId ||
    attempt.attemptId !== q.attemptId
  )
    throw new MetricReadError('unavailable');
  return binding;
}

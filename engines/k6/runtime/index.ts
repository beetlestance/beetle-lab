import { initialSelectionState, metricLayout, selectDatasetRows, selectRequest } from '../plan/index.js';
import type { SelectionState } from '../plan/index.js';
import { runtimeLimits } from './bounds.js';
import { recordAssertions, recordOutcome } from './evidence.js';
import { RuntimeFailure, stop } from './failure.js';
import { prepareReadiness, remaining } from './readiness.js';
import { renderRequest } from './render.js';
import { secretResolver } from './secrets.js';
import type { IterationPosition, IterationResult, Runtime, RuntimeInput } from './types.js';
export type * from './types.js';
export { RuntimeFailure } from './failure.js';
export { validateAttempt } from './attempt.js';
export type { AttemptBudget } from './attempt.js';

/** One instance belongs to one VU; scenario counters never share another VU's state. */
export function createRuntime(input: RuntimeInput): Runtime {
  const limits = runtimeLimits(input.limits);
  const layout = metricLayout(input.suite);
  const secret = secretResolver(input.suite, input.resolveSecret, limits);
  const states = new Map<string, SelectionState>();
  let ownerVu: number | undefined;
  const iterate = (position: IterationPosition): IterationResult => {
    try {
      if (ownerVu !== undefined && ownerVu !== position.vu) stop('selection');
      ownerVu = position.vu;
      return execute({ input, position, states, secret, limits, layout });
    } catch (error) { return executionError(input, error); }
  };
  return { iterate, prepare: deadlineMs => {
    try { prepareReadiness({ ...input, limits, secret, layout, deadlineMs }); }
    catch (error) {
      const result = executionError(input, error);
      stop(result.code === 'adapter' ? 'adapter' : 'preparation');
    }
  } };
}
function executionError(input: RuntimeInput, error: unknown): IterationResult {
  let code = error instanceof RuntimeFailure ? error.code : 'adapter' as const;
  try { input.adapters.metric('beetle_execution_failures', 1, {}); }
  catch { code = 'adapter'; }
  return { kind: 'execution', code, requiredFailures: 0, optionalFailures: 0 };
}
interface Execution {
  input: RuntimeInput; position: IterationPosition; states: Map<string, SelectionState>;
  secret: (name: string) => string; limits: ReturnType<typeof runtimeLimits>; layout: ReturnType<typeof metricLayout>;
}
function choose(execution: Execution): { requestId: string; waitMs: number } {
  const { input, position, states } = execution;
  const plan = input.suite.selections.find(plan => plan.scenarioId === position.scenarioId);
  if (!plan) return stop('selection');
  const initial = initialSelectionState(plan, position.vu);
  if (!initial.ok) return stop('selection');
  const state = states.get(plan.scenarioId) ?? initial.value;
  if (position.iteration !== state.iteration) return stop('selection');
  const selected = selectRequest(plan, state, () => input.adapters.random());
  if (!selected.ok) return stop(selected.issues[0]?.code === 'exhausted' ? 'exhausted' : 'selection');
  states.set(plan.scenarioId, selected.value.state);
  return selected.value;
}
function execute(execution: Execution): IterationResult {
  const { input, position, limits, layout } = execution;
  remaining(position.deadlineMs, input.adapters.now(), limits.requestTimeoutMs);
  const selection = choose(execution);
  const rows = selectDatasetRows(input.suite.datasets, position, () => input.adapters.random());
  if (!rows.ok) return stop('selection');
  const index = input.suite.requests.findIndex(request => request.id === selection.requestId);
  const plan = input.suite.requests[index];
  if (!plan) return stop('selection');
  const request = renderRequest({ target: input.suite.target, plan, label: layout.requests[index]!.label,
    scope: { rows: new Map(rows.value.map(row => [row.datasetId, row.row])), secret: execution.secret },
    timeoutMs: remaining(position.deadlineMs, input.adapters.now(), limits.requestTimeoutMs) });
  request.timeoutMs = remaining(position.deadlineMs, input.adapters.now(), limits.requestTimeoutMs);
  input.adapters.metric('beetle_requests', 1, { request: request.label });
  const outcome = send({ execution, request, index });
  if (input.adapters.now() > position.deadlineMs) stop('deadline');
  if (selection.waitMs) input.adapters.sleep(remaining(position.deadlineMs, input.adapters.now(), selection.waitMs));
  return outcome;
}
function send({ execution, request, index }: { execution: Execution;
  request: Parameters<RuntimeInput['adapters']['http']>[0]; index: number }): IterationResult {
  const { input, layout, limits } = execution;
  let response: ReturnType<RuntimeInput['adapters']['http']>;
  try { response = input.adapters.http(request); }
  catch { response = { status: 0, headers: {}, body: null, transportFailed: true }; }
  if (response.transportFailed) {
    input.adapters.metric('beetle_transport_failures', 1, {});
    return { kind: 'transport', requiredFailures: 0, optionalFailures: 0 };
  }
  const checks = recordAssertions({ assertions: input.suite.requests[index]!.assertions,
    labels: layout.requests[index]!.assertions, response, adapters: input.adapters, limits });
  return recordOutcome(checks, input.adapters);
}

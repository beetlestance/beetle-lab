import { sleep } from 'k6';
import execution from 'k6/execution';
import http from 'k6/http';
import { Counter } from 'k6/metrics';
import { counterNames, metricLayout } from '../plan/index.js';
import type { CompiledSuite, CounterName, DeepReadonly } from '../plan/index.js';
import { utf8Bytes } from './bounds.js';
import { attemptDeadline, setupDeadline, validateAttempt } from './attempt.js';
import type { AttemptBudget } from './attempt.js';
import { nativeMetric, nativePhase } from './phase.js';
import { stop } from './failure.js';
import { createRuntime } from './index.js';
import type { HttpRequest, HttpResponse, Runtime, RuntimeAdapters } from './types.js';

export function nativeHttp(request: HttpRequest): HttpResponse {
  // throw:true in nativeOptions suppresses native warning logs with request URLs.
  const response = http.request(request.method, request.url, request.body, { headers: request.headers,
    tags: { request: request.label }, timeout: request.timeoutMs, responseType: request.responseType, redirects: 0 });
  const httpStatusError = response.error_code >= 1400 && response.error_code < 1600;
  return { status: response.status, headers: response.headers, body: response.body,
    transportFailed: response.status === 0 || (response.error_code !== 0 && !httpStatusError) };
}
function nativeCounters(): ReadonlyMap<CounterName, Counter> {
  return new Map(counterNames.map(name => [name, new Counter(name)]));
}
/** Called in init context. Staging must enforce these file bounds before launch. */
function stagedSecrets(suite: DeepReadonly<CompiledSuite>): (name: string) => string {
  const values = new Map<string, string>();
  let aggregate = 0;
  for (const secret of suite.identity.secrets) {
    if (!/^[A-Za-z_][A-Za-z0-9_-]{0,63}$/.test(secret.name)) stop('secret');
    let value: string;
    try { value = open('/beetle/secrets/' + secret.name); } catch { return stop('secret'); }
    if (value.length > 65_536) stop('secret');
    try { aggregate += utf8Bytes(value, 65_536); } catch { return stop('secret'); }
    if (aggregate > 1_048_576) stop('secret');
    values.set(secret.name, value);
  }
  return name => values.get(name) ?? stop('secret');
}
export function createNativeRuntime(suite: DeepReadonly<CompiledSuite>, attempt: AttemptBudget): Runtime {
  validateAttempt(attempt);
  if (attempt.mode === 'managed') attemptDeadline(attempt, Date.now());
  metricLayout(suite);
  const counters = nativeCounters();
  const adapters: RuntimeAdapters = { now: () => Date.now(), random: () => Math.random(),
    sleep: milliseconds => sleep(milliseconds / 1000), http: nativeHttp,
    metric: (name, value, tags) => nativeMetric(counters.get(name)!, name, value, tags) };
  return createRuntime({ suite, adapters, resolveSecret: stagedSecrets(suite) });
}
export function nativeSetup(runtime: Runtime, attempt: AttemptBudget): { deadlineMs: number } {
  nativePhase('prepare');
  const deadlineMs = attemptDeadline(attempt, Date.now());
  runtime.prepare(deadlineMs);
  return { deadlineMs };
}
export function nativeIteration(runtime: Runtime, suite: DeepReadonly<CompiledSuite>, index: number, data: unknown): void {
  nativePhase('execute');
  const scenario = suite.loadPlan.execution.scenarios[index];
  if (!scenario) execution.test.abort('selection');
  const deadlineMs = Math.min(setupDeadline(data), execution.scenario.startTime + scenario.upperBoundMs - scenario.startOffsetMs);
  const result = runtime.iterate({ scenarioId: scenario.id, vu: execution.vu.idInTest,
    iteration: execution.vu.iterationInScenario, deadlineMs });
  if (result.kind === 'execution') execution.test.abort(result.code ?? 'adapter');
}

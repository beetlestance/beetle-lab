import type { CompiledSuite, DeepReadonly, MetricLayout, RequestPlan } from '../plan/index.js';
import { recordAssertions } from './evidence.js';
import { stop } from './failure.js';
import { renderRequest } from './render.js';
import type { RenderScope } from './render.js';
import type { HttpResponse, RuntimeAdapters, RuntimeLimits } from './types.js';

export function remaining(deadlineMs: number, now: number, requested: number): number {
  if (!Number.isFinite(deadlineMs) || !Number.isFinite(now) || deadlineMs - now < 1) return stop('deadline');
  return Math.min(requested, Math.floor(deadlineMs - now));
}
function readinessRequest(suite: DeepReadonly<CompiledSuite>): DeepReadonly<RequestPlan> {
  const plan = suite.readiness!;
  return { id: 'readiness', name: 'readiness', method: 'GET', path: plan.path, query: [], headers: [],
    assertions: plan.assertions, serialization: { urlBytes: 65_536, headerBytes: 65_536, bodyBytes: 8_388_608 },
    assertionFailureClass: 'assertion', transportFailureClass: 'transport' };
}
/** Retries are preparation only. No dataset rows or secret-bearing setup return. */
export function prepareReadiness(input: { suite: DeepReadonly<CompiledSuite>; adapters: RuntimeAdapters;
  limits: RuntimeLimits; secret: RenderScope['secret']; layout: MetricLayout; deadlineMs: number }): void {
  const { suite, adapters, layout } = input;
  const plan = suite.readiness;
  if (!plan) { remaining(input.deadlineMs, adapters.now(), 1); return; }
  const deadlineMs = Math.min(input.deadlineMs, adapters.now() + plan.wallBudgetMs);
  const requestPlan = readinessRequest(suite);
  for (let attempt = 0; attempt < plan.attempts; attempt++) {
    const timeoutMs = remaining(deadlineMs, adapters.now(), plan.timeoutMs);
    const request = renderRequest({ target: suite.target, plan: requestPlan,
      scope: { rows: new Map(), secret: input.secret }, timeoutMs, label: layout.readiness!.label });
    request.timeoutMs = remaining(deadlineMs, adapters.now(), plan.timeoutMs);
    adapters.metric('beetle_requests', 1, { request: request.label });
    let response: HttpResponse;
    try { response = adapters.http(request); }
    catch { response = { status: 0, headers: {}, body: null, transportFailed: true }; }
    if (response.transportFailed) adapters.metric('beetle_transport_failures', 1, {});
    else {
      const checks = recordAssertions({ assertions: plan.assertions, labels: layout.readiness!.assertions,
        response, adapters, limits: input.limits });
      if (response.status === plan.expectedStatus && checks.every(check => check.passed || !check.required)
        && adapters.now() <= deadlineMs) return;
    }
    if (attempt + 1 < plan.attempts && plan.intervalMs) {
      const delay = remaining(deadlineMs, adapters.now(), plan.intervalMs);
      adapters.sleep(delay);
    }
  }
  stop('preparation');
}

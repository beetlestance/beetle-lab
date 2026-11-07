import { compiled, fixture } from '../suite/fixtures.js';
import type { CompiledSuite, SuiteConfig } from '../../plan/index.js';
import { createRuntime } from '../../runtime/index.js';
import type { HttpRequest, HttpResponse, RuntimeAdapters, RuntimeInput } from '../../runtime/index.js';

export function configFor(method: SuiteConfig['requests'][number]['method'] = 'GET'): SuiteConfig {
  const config = fixture();
  const request = config.requests.find(request => request.method === method)!;
  config.requests = [request];
  config.selections[0]!.entries = [{ requestId: request.id, weight: 1, maxIterationsPerVu: 10,
    wait: { durationMs: 0, jitterMs: 0 } }];
  return config;
}
export const goodResponse: HttpResponse = { status: 200, transportFailed: false,
  headers: { 'x-id': 'a' }, body: '{"users":[{"id":1}],"message":"ok ready","count":1}' };
export function harness(suite: CompiledSuite = compiled(configFor()), options: Partial<RuntimeInput> = {}) {
  const requests: HttpRequest[] = [];
  const metrics: { name: string; value: number; tags: Readonly<Record<string, string>> }[] = [];
  const sleeps: number[] = [];
  let now = 1000;
  let response = goodResponse;
  let random = 0;
  const adapters: RuntimeAdapters = { now: () => now, random: () => random,
    sleep: milliseconds => { sleeps.push(milliseconds); now += milliseconds; },
    http: request => { requests.push(request); return response; },
    metric: (name, value, tags) => { metrics.push({ name, value, tags }); } };
  const runtime = createRuntime({ suite, adapters, resolveSecret: () => 'synthetic-secret-canary', ...options });
  return { runtime, requests, metrics, sleeps, adapters,
    setResponse: (value: HttpResponse) => { response = value; },
    setNow: (value: number) => { now = value; }, setRandom: (value: number) => { random = value; },
    iterate: (iteration = 0, deadlineMs = 60_000) => runtime.iterate({ scenarioId: 'main', vu: 1, iteration, deadlineMs }) };
}

import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import '../../runtime/native-api.d.ts';
const state = vi.hoisted(() => ({ tags: {} as Record<string, string>, points: [] as { name: string; tags: Record<string, string> }[], failMarker: false }));
vi.mock('k6', () => ({ sleep: vi.fn() }));
vi.mock('k6/execution', () => ({ default: { vu: { idInTest: 1, iterationInScenario: 0, metrics: { tags: state.tags } },
  scenario: { startTime: 1000 }, test: { abort: vi.fn() } } }));
vi.mock('k6/http', () => ({ default: { request: vi.fn() } }));
vi.mock('k6/metrics', () => ({ Counter: class {
  constructor(private readonly name: string) {}
  add(_value: number, tags: Record<string, string>) {
    state.points.push({ name: this.name, tags: { ...state.tags, ...tags } });
    if (state.failMarker && this.name === 'beetle_measure_started') throw new Error('marker');
  }
} }));
import http from 'k6/http';
import { createNativeRuntime, nativeIteration, nativeSetup } from '../../runtime/native.js';
import { metricEvidenceLayout } from '../../plan/index.js';
import { nativeOptions } from '../../runtime/options.js';
import { compiled } from '../suite/fixtures.js';
import { configFor } from './fixtures.js';
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const attempt = { mode: 'standalone' as const, timeoutMs: 1000 };
beforeEach(() => {
  state.points.length = 0; state.failMarker = false; delete state.tags.phase;
  vi.stubGlobal('open', () => 'synthetic'); vi.spyOn(Date, 'now').mockReturnValue(1000);
  vi.mocked(http.request).mockReturnValue({ status: 200, error_code: 0, headers: {}, body: 'ok ready' });
});
it.each([false, true])('sets setup phase with readiness disabled=%s and restores prepare after marker', disabled => {
  const config = configFor(); if (disabled) delete config.readiness;
  const suite = compiled(config); const runtime = createNativeRuntime(suite, attempt);
  const data = nativeSetup(runtime, attempt);
  expect(state.tags.phase).toBe('prepare');
  expect(state.points.filter(item => item.name === 'beetle_measure_started')).toEqual([{ name: 'beetle_measure_started', tags: {} }]);
  if (!disabled) expect(state.points[0]!.tags).toEqual({ phase: 'prepare', request: 'r1' });
  nativeIteration(runtime, suite, 0, data);
  expect(state.tags.phase).toBe('execute');
  expect(state.points.find(item => item.tags.phase === 'execute')!.tags).toEqual({ phase: 'execute', request: 'r0' });
});
it('restores prepare when marker add throws, including the engine failure sample', () => {
  state.failMarker = true;
  const config = configFor(); delete config.readiness;
  expect(() => nativeSetup(createNativeRuntime(compiled(config), attempt), attempt)).toThrow('adapter');
  expect(state.tags.phase).toBe('prepare');
  expect(state.points.at(-1)).toEqual({ name: 'beetle_execution_failures', tags: { phase: 'prepare' } });
});
it('keeps failed and retried readiness in preparation without fabricating markers', () => {
  const suite = compiled(configFor());
  vi.mocked(http.request).mockReturnValue({ status: 500, error_code: 1500, headers: {}, body: 'bad' });
  expect(() => nativeSetup(createNativeRuntime(suite, attempt), attempt)).toThrow('preparation');
  expect(state.points.every(item => item.tags.phase === 'prepare')).toBe(true);
  expect(state.points.filter(item => item.name === 'beetle_requests')).toHaveLength(3);
  state.points.length = 0;
  vi.mocked(http.request).mockReturnValueOnce({ status: 500, error_code: 1500, headers: {}, body: 'bad' })
    .mockReturnValue({ status: 200, error_code: 0, headers: {}, body: 'ready' });
  nativeSetup(createNativeRuntime(suite, attempt), attempt);
  expect(state.points.filter(item => item.name === 'beetle_requests')).toHaveLength(2);
  expect(state.tags.phase).toBe('prepare');
});
it('shares phase-first native criteria and preserves discovery inverse abort, engine gauges and rate denominators', () => {
  const config = configFor();
  config.loadPlan.slos = [{ id: 'rate', metric: 'http_reqs', stat: 'rate', operator: '>', value: 3 },
    { id: 'gauges', metric: 'vus', stat: 'value', operator: '<=', value: 8 }];
  config.loadPlan.scenarios = [{ id: 'main', name: 'main', executor: 'ramp-until', startTime: '0s', gracefulStop: '0s',
    startRate: 1, maxRate: 2, stepRate: 1, stepDuration: '1s', timeUnit: '1s', preAllocatedVUs: 1, maxVUs: 2,
    stopRule: { id: 'stop', metric: 'http_req_duration', stat: 'p95', operator: '>', value: 10 } }];
  const suite = compiled(config); const layout = metricEvidenceLayout(suite);
  expect(nativeOptions(suite, attempt).thresholds['http_req_duration{phase:execute}'])
    .toContainEqual({ threshold: 'p(95)<=10', abortOnFail: true });
  expect(layout.metrics.find(item => item.key === 'beetle_requests{request:r0}')!.nativeKey)
    .toBe('beetle_requests{phase:execute,request:r0}');
  expect(layout.metrics.find(item => item.key === 'http_reqs')).toMatchObject({ scope: 'execute', provenance: { counterRateDenominator: 'engine-duration' } });
  expect(layout.metrics.find(item => item.key === 'http_req_failed')!.provenance.rateDenominator).toBe('samples');
  expect(layout.metrics.find(item => item.key === 'vus')).toMatchObject({ scope: 'engine', nativeKey: 'vus' });
});

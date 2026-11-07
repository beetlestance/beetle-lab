import { afterEach, describe, expect, it, vi } from 'vitest';
import '../../runtime/native-api.d.ts';
vi.mock('k6', () => ({ sleep: vi.fn() }));
vi.mock('k6/execution', () => ({ default: { test: { abort: vi.fn() }, vu: { idInTest: 1, iterationInScenario: 0 }, scenario: { startTime: 0 } } }));
vi.mock('k6/http', () => ({ default: { request: vi.fn() } }));
vi.mock('k6/metrics', () => ({ Counter: class { add = vi.fn(); } }));
import http from 'k6/http';
import execution from 'k6/execution';
import { createNativeRuntime, nativeHttp, nativeIteration, nativeSetup } from '../../runtime/native.js';
import { compiled } from '../suite/fixtures.js';
import { configFor } from './fixtures.js';
const attempt = { mode: 'standalone' as const, timeoutMs: 30_000 };

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.clearAllMocks(); });
describe('native API delegation', () => {
  const request = { method: 'GET' as const, url: 'https://synthetic.invalid/', body: null, headers: {},
    timeoutMs: 123, responseType: 'none' as const, label: 'r0' };
  it.each([[200, 0, false], [404, 1404, false], [503, 1503, false], [0, 1050, true], [200, 1701, true]] as const)(
    'classifies status%s/error%s transport=%s', (status, error_code, transportFailed) => {
      vi.mocked(http.request).mockReturnValue({ status, error_code, headers: {}, body: null });
      expect(nativeHttp(request)).toMatchObject({ status, transportFailed });
      expect(http.request).toHaveBeenCalledWith('GET', request.url, null, { headers: {}, tags: { request: 'r0' },
        timeout: 123, responseType: 'none', redirects: 0 });
    });
  it('reads only declared trusted stage paths and keeps private values out of outcomes', () => {
    const load = vi.fn(() => 'private-native-secret-canary'); vi.stubGlobal('open', load);
    const runtime = createNativeRuntime(compiled(configFor()), attempt);
    expect(load).toHaveBeenCalledExactlyOnceWith('/beetle/secrets/auth');
    vi.mocked(http.request).mockReturnValue({ status: 500, error_code: 1500, body: null, headers: {} });
    const result = runtime.iterate({ scenarioId: 'main', vu: 1, iteration: 0, deadlineMs: Date.now() + 1000 });
    expect(result.kind).toBe('assertion'); expect(JSON.stringify(result)).not.toContain('private-native-secret');
    expect(vi.mocked(http.request).mock.calls[0]![3].headers.authorization).toContain('private-native-secret');
  });
  it('includes accepted grace without counting the scenario offset twice', () => {
    vi.stubGlobal('open', () => 'synthetic'); vi.spyOn(Date, 'now').mockReturnValue(1000);
    execution.scenario.startTime = 1000;
    const config = configFor('POST');
    config.loadPlan.scenarios[0]!.startTime = '3s'; config.loadPlan.scenarios[0]!.gracefulStop = '2s';
    const suite = compiled(config);
    vi.mocked(http.request).mockReturnValue({ status: 200, error_code: 0, body: null, headers: {} });
    nativeIteration(createNativeRuntime(suite, attempt), suite, 0, { deadlineMs: 50_000 });
    expect(vi.mocked(http.request).mock.calls[0]![3].timeout).toBe(12_000);
  });
  it('delegates global native VU identity100001 across two concurrently accepted scenarios', () => {
    vi.stubGlobal('open', () => 'synthetic'); vi.spyOn(Date, 'now').mockReturnValue(1000);
    execution.scenario.startTime = 1000;
    const config = configFor('POST'); const scenario = config.loadPlan.scenarios[0]!;
    if (scenario.executor !== 'per-vu-iterations') throw new Error('fixture');
    scenario.vus = 100_000;
    config.loadPlan.scenarios.push({ ...scenario, id: 'other', name: 'other', vus: 1 });
    config.selections.push({ ...config.selections[0]!, scenarioId: 'other' });
    const suite = compiled(config); const runtime = createNativeRuntime(suite, attempt);
    vi.mocked(http.request).mockReturnValue({ status: 200, error_code: 0, body: null, headers: {} });
    const previousVu = execution.vu.idInTest; execution.vu.idInTest = 100_001;
    try {
      for (const index of [0, 1]) nativeIteration(runtime, suite, index, { deadlineMs: 50_000 });
      expect(execution.test.abort).not.toHaveBeenCalled();
      expect(http.request).toHaveBeenCalledTimes(2);
    } finally { execution.vu.idInTest = previousVu; }
  });
  it('clamps every scenario to one setup deadline and fails delayed work closed', () => {
    vi.stubGlobal('open', () => 'synthetic');
    let now = 1000; vi.spyOn(Date, 'now').mockImplementation(() => now);
    execution.scenario.startTime = now;
    const suite = compiled(configFor('POST'));
    const budget = { mode: 'managed' as const, timeoutMs: 50, deadlineMs: 1800 };
    const runtime = createNativeRuntime(suite, budget);
    vi.mocked(http.request).mockReturnValue({ status: 200, error_code: 0, body: 'ready', headers: {} });
    const data = nativeSetup(runtime, budget); expect(data).toEqual({ deadlineMs: 1050 });
    expect(vi.mocked(http.request).mock.calls[0]![3].timeout).toBe(50);
    vi.mocked(http.request).mockClear();
    nativeIteration(runtime, suite, 0, data);
    expect(vi.mocked(http.request).mock.calls[0]![3].timeout).toBe(50);
    vi.mocked(http.request).mockClear(); now = 2000; execution.scenario.startTime = now;
    nativeIteration(runtime, suite, 0, data);
    expect(http.request).not.toHaveBeenCalled(); expect(execution.test.abort).toHaveBeenCalledWith('deadline');
    expect(() => nativeIteration(runtime, suite, 0, undefined)).toThrow('deadline');
  });
  it('rejects an expired managed attempt before native secret file effects', () => {
    vi.spyOn(Date, 'now').mockReturnValue(1000);
    const load = vi.fn(() => 'canary'); vi.stubGlobal('open', load);
    expect(() => createNativeRuntime(compiled(configFor()), { mode: 'managed', timeoutMs: 1000, deadlineMs: 999 })).toThrow('deadline');
    expect(load).not.toHaveBeenCalled(); expect(http.request).not.toHaveBeenCalled();
  });
  it('rejects secret file and aggregate overflow or unapproved altered names', () => {
    vi.stubGlobal('open', vi.fn(() => 'a'.repeat(65_537)));
    expect(() => createNativeRuntime(compiled(configFor()), attempt)).toThrow('secret');
    const config = configFor(); config.secrets = Array.from({ length: 17 }, (_, index) => ({ name: `s-${index}`, provider: 'fixture', locator: 'opaque' }));
    config.requests[0]!.headers = {};
    vi.stubGlobal('open', vi.fn(() => 'a'.repeat(65_536)));
    expect(() => createNativeRuntime(compiled(config), attempt)).toThrow('secret');
    const suite = structuredClone(compiled(config)); suite.identity.secrets[0]!.name = '../outside';
    const load = vi.fn(() => 'unused'); vi.stubGlobal('open', load);
    expect(() => createNativeRuntime(suite, attempt)).toThrow('secret'); expect(load).not.toHaveBeenCalled();
  });
});

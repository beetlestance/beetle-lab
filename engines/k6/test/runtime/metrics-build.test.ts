import { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildRuntimeScript } from '../../build/index.js';
import { writePlanData } from '../../build/serialize.js';
import { metricLayout } from '../../plan/index.js';
import { nativeOptions } from '../../runtime/options.js';
import { summaryProjection } from '../../runtime/summary.js';
import { validateAndCompileSuite } from '../../compiler/suite/validation.js';
import { compiled, dependencies } from '../suite/fixtures.js';
import { configFor, harness } from './fixtures.js';

describe('bounded metric and build boundaries', () => {
  it('admits exact combined cardinality at200 and rejects201 before execution effects', () => {
    const config = configFor(); delete config.readiness;
    config.requests = Array.from({ length: 3 }, (_, index) => ({ ...config.requests[0]!, id: `r${index}`, name: `name${index}`,
      assertions: Array.from({ length: 64 }, (_, assertion) => ({ id: `a${assertion}`, kind: 'statusEq', required: true, value: 200 })) }));
    config.requests.push({ ...config.requests[0]!, id: 'extra', name: 'extra', assertions: [
      { id: 'one', kind: 'statusEq', required: true, value: 200 }, { id: 'two', kind: 'statusEq', required: true, value: 200 },
      { id: 'three', kind: 'statusEq', required: true, value: 200 }] });
    config.selections[0]!.entries[0]!.requestId = 'r0';
    expect(metricLayout(compiled(config)).labelSets).toBe(200);
    config.requests[3]!.assertions.push({ id: 'four', kind: 'statusEq', required: true, value: 200 });
    const rejected = validateAndCompileSuite(config, dependencies());
    expect(rejected).toEqual({ ok: false, issues: [{ path: '', code: 'metric_limit' }] });
  });
  it.each([['made_up', 'count'], ['http_req_duration', 'rate'], ['http_req_failed', 'avg'], ['beetle_required_failures', 'value']] as const)(
    'rejects unsupported metric/stat %s/%s', (metric, stat) => {
      const config = configFor(); config.loadPlan.slos = [{ id: 'bad', metric, stat, operator: '<', value: 1 }];
      expect(validateAndCompileSuite(config, dependencies())).toMatchObject({ ok: false, issues: [{ code: 'metric' }] });
    });
  it('validates discovery stop rules and preserves supported native semantics', () => {
    const config = configFor();
    config.loadPlan.scenarios = [{ id: 'main', name: 'main', executor: 'ramp-until', startTime: '0s', gracefulStop: '0s',
      startRate: 1, maxRate: 2, stepRate: 1, stepDuration: '1s', timeUnit: '1s', preAllocatedVUs: 1, maxVUs: 2,
      stopRule: { id: 'stop', metric: 'unknown', stat: 'count', operator: '>', value: 1 } }];
    expect(validateAndCompileSuite(config, dependencies())).toMatchObject({ ok: false, issues: [{ code: 'metric' }] });
    const options = nativeOptions(compiled(configFor()), { mode: 'standalone', timeoutMs: 1000 });
    expect(options.systemTags).toEqual([]); expect(options.throw).toBe(true); expect(options.maxRedirects).toBe(0);
    expect(options.thresholds.beetle_required_failures).toContainEqual({ threshold: 'count==0', abortOnFail: false });
    expect(options.thresholds.http_req_failed).toBeUndefined();
  });
  it('never exposes secret/request/error/native-root data through evidence', () => {
    const suite = compiled(configFor()); const test = harness(suite); test.iterate();
    const projected = summaryProjection(suite, { secret: 'secret-canary', root_group: { name: 'secret-canary' },
      metrics: { url: 'secret-canary', http_req_duration: { values: { avg: 1, unknown: 'secret-canary' } },
        beetle_required_failures: { values: { count: 1 }, thresholds: { 'count==0': { ok: false, message: 'secret-canary' } } } } });
    expect(projected).not.toMatch(/secret-canary|synthetic-secret/);
    expect(JSON.parse(projected).metrics.beetle_required_failures).toMatchObject({ values: { count: 1 },
      thresholds: [{ expression: 'count>=0', ok: null }, { expression: 'count==0', ok: false }] });
    expect(JSON.stringify(test.metrics)).not.toMatch(/synthetic.invalid|synthetic-secret|users|iteration|vu/);
    expect(Buffer.byteLength(projected)).toBeLessThan(1_048_576);
  });
  it('enforces aggregate secret admission before HTTP and keeps state private', () => {
    const config = configFor();
    config.secrets = Array.from({ length: 17 }, (_, index) => ({ name: `s${index}`, provider: 'fixture', locator: 'opaque' }));
    config.requests[0]!.headers = Object.fromEntries(config.secrets.map(secret => [`X-${secret.name}`, `{{secret.${secret.name}}}`]));
    const test = harness(compiled(config), { resolveSecret: () => 'a'.repeat(65_536) });
    const suite = structuredClone(compiled(config)); suite.requests[0]!.serialization.headerBytes = 2_000_000;
    const admitted = harness(suite, { resolveSecret: () => 'a'.repeat(65_536) });
    expect(admitted.iterate().code).toBe('secret'); expect(admitted.requests).toHaveLength(0);
    expect(test.iterate().kind).toBe('execution');
  });
  it('streams bounded plan data and rejects excessive/cyclic data before writes', async () => {
    const directory = await mkdtemp('/private/tmp/w09-serialize-');
    try {
      const path = join(directory, 'plan.json');
      await expect(writePlanData(path, { text: 'a'.repeat(65_537) })).rejects.toThrow('script_limit');
      expect(await readdir(directory)).toEqual([]);
      const cyclic: Record<string, unknown> = {}; cyclic.self = cyclic;
      await expect(writePlanData(path, cyclic)).rejects.toThrow('script_data');
      await expect(writePlanData(path, Array.from({ length: 6500 }, () => 'a'.repeat(4096)))).rejects.toThrow('script_limit');
      expect(await readdir(directory)).toEqual([]);
      const data = { rows: Array.from({ length: 2000 }, () => 'a'.repeat(128)), unicode: '🙂' };
      const bytes = await writePlanData(path, data);
      expect((await stat(path)).size).toBe(bytes); expect(JSON.parse(await readFile(path, 'utf8'))).toEqual(data);
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
  it('builds the owned runtime source without compiler validators, Node modules or secret values', async () => {
    const directory = await mkdtemp('/private/tmp/w09-build-');
    try {
      const suite = compiled(configFor());
      const output = await buildRuntimeScript({ suite, outputDirectory: directory, attempt: { mode: 'standalone', timeoutMs: 1000 } });
      const source = await readFile(output.scriptPath, 'utf8');
      expect(source).toMatch(/k6\/http/); expect(source).toMatch(/loadScenario0/);
      expect(source).not.toMatch(/node:|ajv|json-schema-to-ts|synthetic-secret-canary|require\(/);
      expect(output.bytes).toBe(Buffer.byteLength(source)); expect(output.bytes).toBeLessThan(67_108_864);
      expect(await readdir(directory)).toEqual(['suite.js']);
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
});

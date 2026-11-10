import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import { afterEach } from 'vitest';
import { transform } from 'esbuild';
import { validateAndCompileSuite } from '../../compiler/suite/validation.js';
import type { CompiledSuite, DeepReadonly } from '../../plan/index.js';
import type { AttemptBudget } from '../../runtime/index.js';
import type { nativeOptions } from '../../runtime/options.js';
import { fixture, dependencies, input } from '../suite/fixtures.js';
import { planWith } from '../compiler/fixtures.js';

export function directories() {
  const paths: string[] = [];
  afterEach(async () => { await Promise.all(paths.splice(0).map(path => rm(path, { recursive: true, force: true }))); });
  return async () => { const path = await realpath(await mkdtemp(join(tmpdir(), 'beetle-k6-export-'))); paths.push(path); return path; };
}
export function suite(options: { embedded?: boolean; allScenarios?: boolean; secrets?: boolean } = {}): DeepReadonly<CompiledSuite> {
  const config = fixture(); config.requests[0]!.headers = {};
  if (!options.secrets) config.secrets = [];
  const inputs = [];
  if (options.embedded) {
    const csv = input('label,token\nalpha,café\n'); const json = input('[{"value":"pinned-value"}]', 2);
    const text = input('text café {{data.csv.label}}', 3); const body = input('{"name":"{{data.json.value}}","emoji":"🪲"}', 4);
    inputs.push(csv, json, text, body);
    config.datasets.push({ id: 'csv', kind: 'csv', selection: 'byVu', input: csv.ref },
      { id: 'json', kind: 'json', selection: 'byVu', input: json.ref });
    config.requests[0]!.path = '/embedded/{{data.csv.label}}'; config.requests[0]!.query = { value: '{{data.json.value}}' };
    config.requests[0]!.headers = { 'X-CSV': '{{data.csv.token}}' };
    config.requests[1]!.body = { kind: 'input', format: 'text', input: text.ref };
    config.requests[2]!.body = { kind: 'input', format: 'json', input: body.ref };
  }
  if (options.allScenarios) config.loadPlan = planWith();
  config.selections = config.loadPlan.scenarios.map((scenario, index) => ({ scenarioId: scenario.id,
    entries: [{ requestId: ['get', 'post', 'put'][index % 3]!, weight: 1, maxIterationsPerVu: 10, wait: { durationMs: 0, jitterMs: 0 } }] }));
  const result = validateAndCompileSuite(config, dependencies(inputs));
  if (!result.ok) throw new Error('Export fixture rejected: ' + JSON.stringify(result.issues));
  return result.value;
}
interface ExportedModule {
  readonly attempt: AttemptBudget;
  readonly options: ReturnType<typeof nativeOptions>;
  setup(): { deadlineMs: number };
  readonly [name: `loadScenario${number}`]: (data: unknown) => void;
}
/** Executes only the trusted actual bundle with synthetic, network-free native adapters. */
export async function inspect(source: string) {
  const requests: { method: string; url: string; body: string | null; params: { headers: Record<string, string>; timeout: number } }[] = [];
  const metrics: { name: string; value: number; tags: unknown }[] = [];
  class Counter {
    constructor(private readonly name: string) {}
    add(value: number, tags: unknown) { metrics.push({ name: this.name, value, tags }); }
  }
  const execution = { vu: { idInTest: 1, iterationInScenario: 0, metrics: { tags: {} } }, scenario: { startTime: 1000 },
    test: { abort(reason: string): never { throw new Error(reason); } } };
  const native = { 'k6': { sleep: () => undefined }, 'k6/metrics': { Counter }, 'k6/execution': execution,
    'k6/http': { request(method: string, url: string, body: string | null, params: { headers: Record<string, string>; timeout: number }) {
      requests.push({ method, url, body, params });
      return { status: 200, error_code: 0, headers: { 'x-id': 'a' }, body: '{"users":[{"id":1}],"message":"ok ready","count":1}' };
    } } };
  const module = { exports: {} }; const random = Object.create(Math) as Math; random.random = () => 0;
  class FixedDate extends Date { static override now() { return 1000; } }
  const transformed = await transform(source, { format: 'cjs', target: 'es2020', sourcefile: 'actual-export.js' });
  runInNewContext(transformed.code, { module, exports: module.exports, Date: FixedDate, Math: random,
    require(name: string) {
      if (!Object.hasOwn(native, name)) throw new Error('Unapproved bundle dependency');
      return native[name as keyof typeof native];
    }, open(): never { throw new Error('Standalone export attempted file access'); } }, { timeout: 1000 });
  return { value: module.exports as ExportedModule, requests, metrics };
}

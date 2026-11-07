import type { CompileInput, CompiledSuite, SuiteConfig } from '../../compiler/suite/index.js';
import { sha256, validateAndCompileSuite } from '../../compiler/suite/validation.js';
export const engine = { version: '0.57.0', imageDigest: 'sha256:' + '1'.repeat(64) };
export function fixture(): SuiteConfig {
  return { version: 1, target: 'https://synthetic.invalid/api/',
    loadPlan: { version: 1, scenarios: [{ id: 'main', name: 'main', executor: 'per-vu-iterations',
      startTime: '0s', gracefulStop: '0s', vus: 2, iterations: 10, maxDuration: '10s' }], slos: [] },
    datasets: [{ id: 'users', kind: 'inline', selection: 'random', rows: [{ user: 'one', token: 't1' }, { user: 'two', token: 't2' }] },
      { id: 'numbers', kind: 'range', selection: 'byVu', column: 'value', start: 1, end: 5, step: 2 }],
    secrets: [{ name: 'auth', provider: 'fixture', locator: 'opaque-reference', version: 'v1' }],
    requests: [{ id: 'get', name: 'read', method: 'GET', path: '/users/{{data.users.user}}', query: { n: '{{data.numbers.value}}' },
      headers: { Authorization: 'Bearer {{secret.auth}}', 'X-Token': '{{data.users.token}}' }, assertions: [
        { id: 'exact', kind: 'statusEq', required: true, value: 200 },
        { id: 'family', kind: 'statusFamily', required: false, value: 2 },
        { id: 'body', kind: 'bodyContains', required: true, value: 'ok' },
        { id: 'hexists', kind: 'headerExists', required: true, name: 'X-Id' },
        { id: 'hequals', kind: 'headerEquals', required: true, name: 'X-Id', value: 'a' },
        { id: 'hcontains', kind: 'headerContains', required: false, name: 'X-Id', value: 'a' },
        { id: 'jexists', kind: 'jsonExists', required: true, path: '$.users[0].id' },
        { id: 'jequals', kind: 'jsonEquals', required: true, path: '$.users[0].id', value: 1 },
        { id: 'jcontains', kind: 'jsonContains', required: true, path: '$.message', value: 'ok' },
        { id: 'jcompare', kind: 'jsonCompare', required: true, path: '$.count', operator: 'gte', value: 1 },
      ] },
      ...(['POST', 'PUT', 'PATCH', 'DELETE'] as const).map(method => ({ id: method.toLowerCase(), name: method,
        method, path: '/write', query: {}, headers: {}, body: { kind: 'json' as const,
          value: { user: '{{data.users.user}}', list: [null, true, 42], nested: { token: '{{data.users.token}}' } } }, assertions: [] })),
    ], selections: [{ scenarioId: 'main', entries: [
      { requestId: 'get', weight: 1, maxIterationsPerVu: 2, wait: { durationMs: 10, jitterMs: 5 } },
      { requestId: 'post', weight: 3, maxIterationsPerVu: 1, wait: { durationMs: 0, jitterMs: 0 } },
    ] }], readiness: { path: '/health', attempts: 3, intervalMs: 20, timeoutMs: 100, wallBudgetMs: 340,
      expectedStatus: 200, assertions: [{ id: 'ready', required: true, kind: 'bodyContains', value: 'ready' }] },
  };
}
export function input(content: string, index = 1): CompileInput['inputs'][number] {
  return { ref: { id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`, sha256: sha256(content), bytes: Buffer.byteLength(content) }, content };
}
export function dependencies(inputs: CompileInput['inputs'] = []): CompileInput { return { engine: { ...engine }, inputs }; }
export function compiled(config: unknown = fixture(), deps: unknown = dependencies()): CompiledSuite {
  const result = validateAndCompileSuite(config, deps);
  if (!result.ok) throw new Error('Fixture failed: ' + JSON.stringify(result.issues));
  return result.value as CompiledSuite;
}

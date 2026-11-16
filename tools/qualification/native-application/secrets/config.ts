import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createK6ConfigSchema} from '@beetle/contracts/engine-config/k6';
import type {SuiteConfig} from '../../../../engines/k6/compiler/suite/index.js';
export function configuration(): SuiteConfig {
 const config: SuiteConfig = {version: 1, target: 'http://target:8080', datasets: [],
 secrets: [{name: 'environment', provider: 'env', locator: 'environment-ref', version: 'v1'}, {name: 'mounted', provider: 'mounted', locator: 'mounted-ref', version: 'v1'}],
 loadPlan: {version: 1, scenarios: [{id: 'main', name: 'main', executor: 'per-vu-iterations', vus: 1, iterations: 3, maxDuration: '8s', startTime: '0s', gracefulStop: '0s'}], slos: []},
 requests: [{id: 'work', name: 'work', method: 'GET', path: '/work', query: {}, headers: {'X-Environment': '{{secret.environment}}', 'X-Mounted': '{{secret.mounted}}'},
 assertions: [{id: 'ok', kind: 'statusEq', value: 200, required: true}]}],
 selections: [{scenarioId: 'main', entries: [{requestId: 'work', weight: 1, maxIterationsPerVu: 3, wait: {durationMs: 50, jitterMs: 0}}]}],
 readiness: {path: '/ready', attempts: 1, intervalMs: 0, timeoutMs: 1000, wallBudgetMs: 1000, expectedStatus: 200, assertions: []}};
 assert(createK6ConfigSchema(value => createHash('sha256').update(value).digest('hex')).validate(config)); return config;
}

import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import type {SuiteRevision} from '@beetle/contracts/api';
import {createK6ConfigSchema} from '@beetle/contracts/engine-config/k6';
export async function configuration() {
  const source = JSON.parse(await readFile('contracts/fixtures/api/valid/suite-revision.json', 'utf8')) as SuiteRevision;
  const config = source.config; config.target = 'http://target:8080'; config.secrets = [];
  config.requests = [{id: 'get', name: 'Owned finite work', method: 'GET', path: '/work', query: {}, headers: {}, assertions: [{id: 'ok', kind: 'statusEq', value: 200, required: true}]}];
  config.readiness = {path: '/ready', attempts: 1, intervalMs: 0, timeoutMs: 1000, wallBudgetMs: 1000, expectedStatus: 200, assertions: []};
  config.loadPlan = {version: 1, scenarios: [{id: 'main', name: 'Finite_original', executor: 'per-vu-iterations', vus: 1, iterations: 40, maxDuration: '30s', startTime: '0s', gracefulStop: '0s'}], slos: []};
  config.selections = [{scenarioId: 'main', entries: [{requestId: 'get', weight: 1, wait: {durationMs: 500, jitterMs: 0}}]}];
  assert(createK6ConfigSchema(value => createHash('sha256').update(value).digest('hex')).validate(config), 'Finite native fixture must validate before Docker effects');
  return config;
}

export function qualificationCases(mode: string): readonly ('backend' | 'agent' | 'cancel')[] {
  if (mode === 'crashes') return ['backend', 'agent'];
  if (mode === 'cancel') return ['cancel'];
  throw Error('Lifecycle profile must be crashes or cancel');
}

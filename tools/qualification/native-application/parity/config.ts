import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import type {SuiteRevision} from '@beetle/contracts/api';
import {createK6ConfigSchema} from '@beetle/contracts/engine-config/k6';
export type Case = 'executors' | 'discovery-reached' | 'discovery-exhausted' | 'slo' | 'assertion' | 'transport';
export function cases(profile: string): readonly Case[] {
 if (profile === 'executors') return ['executors', 'discovery-reached'];
 if (profile === 'thresholds') return ['discovery-exhausted', 'slo'];
 if (profile === 'failures') return ['assertion', 'transport'];
 throw Error('Unknown parity profile');
}
export async function configuration(kind: Case) {
 const source = JSON.parse(await readFile('contracts/fixtures/api/valid/suite-revision.json', 'utf8')) as SuiteRevision;
 const config = source.config; config.target = 'http://target:8080'; config.secrets = []; config.datasets = [];
 const base = {startTime: '0s', gracefulStop: '0s'};
 const loadPlan = {version: 1, scenarios: kind === 'executors' ? [
  {...base, id: 'arrival', name: 'Arrival', executor: 'constant-arrival-rate', rate: 2, timeUnit: '1s', duration: '2s', preAllocatedVUs: 2, maxVUs: 2},
  {...base, id: 'ramp_arrival', name: 'Ramp_arrival', executor: 'ramping-arrival-rate', startRate: 1, timeUnit: '1s', stages: [{duration: '2s', target: 2}], preAllocatedVUs: 2, maxVUs: 2},
  {...base, id: 'ramp_vus', name: 'Ramp_vus', executor: 'ramping-vus', startVUs: 1, stages: [{duration: '2s', target: 2}], gracefulRampDown: '0s'},
  {...base, id: 'constant', name: 'Constant', executor: 'constant-vus', vus: 1, duration: '2s'},
  {...base, id: 'shared', name: 'Shared', executor: 'shared-iterations', vus: 2, iterations: 3, maxDuration: '8s'},
  {...base, id: 'pervu', name: 'Delayed_per_VU', executor: 'per-vu-iterations', vus: 2, iterations: 3, maxDuration: '8s', startTime: '1s'},
 ] : kind.startsWith('discovery-') ? [{...base, id: 'discovery', name: 'Discovery', executor: 'ramp-until', startRate: 1, maxRate: 2, stepRate: 1, stepDuration: '3s', timeUnit: '1s', preAllocatedVUs: 2, maxVUs: 2,
  stopRule: kind === 'discovery-reached' ? {id: 'stop', metric: 'http_req_duration', stat: 'p99', operator: '>', value: 0} : {id: 'stop', metric: 'http_req_failed', stat: 'rate', operator: '>', value: 1}}]
 : [{...base, id: 'main', name: 'Finite', executor: 'per-vu-iterations', vus: 1, iterations: 3, maxDuration: '8s'}],
 slos: kind === 'slo' ? [{id: 'impossible', metric: 'http_req_duration', stat: 'p99', operator: '<', value: 0}] : []};
 config.loadPlan = loadPlan; const ids = loadPlan.scenarios.map(s => s.id);
 config.requests = ids.map(id => ({id, name: id, method: 'GET', path: '/' + (kind === 'executors' ? id : kind), query: {}, headers: {}, assertions: [{id: 'ok', kind: 'statusEq', value: 200, required: true}]}));
 config.selections = ids.map(id => ({scenarioId: id, entries: [{requestId: id, weight: 1, wait: {durationMs: 100, jitterMs: 0}}]}));
 config.readiness = {path: '/ready', attempts: 1, intervalMs: 0, timeoutMs: 1000, wallBudgetMs: 1000, expectedStatus: 200, assertions: []};
 assert(createK6ConfigSchema(value => createHash('sha256').update(value).digest('hex')).validate(config), 'Native parity fixture schema');
 return config;
}

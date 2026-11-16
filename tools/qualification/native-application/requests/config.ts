import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createK6ConfigSchema} from '@beetle/contracts/engine-config/k6';
import type {SuiteConfig, InputRef, AssertionConfig} from '../../../../engines/k6/compiler/suite/index.js';
export const methods = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const;
export const contents = {json: '[{"user":"J1","token":"JT1"},{"user":"J2","token":"JT2"}]',
 csv: '\uFEFFname,token\r\n"one,first","a""b"\r\n"two\nsecond",t2\r\n', body: '{"source":"immutable body input"}'};
export function assertions(): AssertionConfig[] {
 return [{id: 'status', kind: 'statusEq', value: 200, required: true}, {id: 'family', kind: 'statusFamily', value: 2, required: true},
  {id: 'body', kind: 'bodyContains', value: 'fixture-ok', required: true}, {id: 'hexists', kind: 'headerExists', name: 'X-Fixture', required: true},
  {id: 'hequals', kind: 'headerEquals', name: 'X-Fixture', value: 'native-ok', required: true}, {id: 'hcontains', kind: 'headerContains', name: 'X-Fixture', value: 'native', required: true},
  {id: 'exists', kind: 'jsonExists', path: '$.users[0].id', required: true}, {id: 'equals', kind: 'jsonEquals', path: '$.users[0].id', value: 1, required: true},
  {id: 'contains', kind: 'jsonContains', path: '$.message', value: 'fixture', required: true}, {id: 'compare', kind: 'jsonCompare', path: '$.count', operator: 'gte', value: 1, required: true}];
}
export function configuration(refs: Readonly<Record<'json' | 'csv' | 'body', InputRef>>, malformed = false): SuiteConfig {
 const ids = malformed ? ['malformed'] : methods.map(method => method.toLowerCase());
 const config: SuiteConfig = {version: 1, target: 'http://target:8080', secrets: [], datasets: malformed ? [] : [
  {id: 'inline', kind: 'inline', selection: 'random', rows: [{user: 'one', token: 'A'}, {user: 'two', token: 'B'}]},
  {id: 'json', kind: 'json', input: refs.json, selection: 'byVu'}, {id: 'csv', kind: 'csv', input: refs.csv, selection: 'random'},
  {id: 'numbers', kind: 'range', selection: 'byVu', column: 'value', start: 1, end: 5, step: 2},
  {id: 'identity', kind: 'range', selection: 'byVu', column: 'value', start: 1, end: 128, step: 1}],
  loadPlan: {version: 1, scenarios: ids.map(id => ({id, name: id, executor: 'per-vu-iterations', vus: malformed ? 1 : 2,
   iterations: malformed ? 3 : 2, maxDuration: '8s', startTime: '0s', gracefulStop: '0s'})), slos: []},
  selections: ids.map(id => ({scenarioId: id, entries: [{requestId: id, weight: 1, maxIterationsPerVu: malformed ? 3 : 2, wait: {durationMs: 50, jitterMs: 10}}]})),
  readiness: {path: '/ready', attempts: 2, intervalMs: 20, timeoutMs: 1000, wallBudgetMs: 2020, expectedStatus: 200,
   assertions: [{id: 'ready', kind: 'bodyContains', value: 'fixture-ready', required: true}]},
  requests: malformed ? [{id: 'malformed', name: 'Malformed JSON', method: 'GET', path: '/malformed', query: {}, headers: {}, assertions: assertions()}]
   : methods.map(method => ({id: method.toLowerCase(), name: method, method, path: '/native/' + method.toLowerCase() + '/{{data.inline.user}}',
    query: {identity: '{{data.identity.value}}', inlineToken: '{{data.inline.token}}', jsonUser: '{{data.json.user}}', jsonToken: '{{data.json.token}}', csvName: '{{data.csv.name}}', csvToken: '{{data.csv.token}}', n: '{{data.numbers.value}}'},
    headers: {'X-Identity': '{{data.identity.value}}', 'X-Inline-User': '{{data.inline.user}}', 'X-Inline-Token': '{{data.inline.token}}', 'X-Json-User': '{{data.json.user}}', 'X-Json-Token': '{{data.json.token}}', 'X-Csv-Token': '{{data.csv.token}}', 'X-Number': '{{data.numbers.value}}',
     ...(method === 'GET' ? {} : {'Content-Type': method === 'PUT' ? 'text/plain' : 'application/json'})},
    ...(method === 'GET' ? {} : {body: method === 'PUT' || method === 'PATCH' ? {kind: 'input' as const, input: refs.body, format: method === 'PUT' ? 'text' as const : 'json' as const}
     : {kind: 'json' as const, value: {user: '{{data.inline.user}}', token: '{{data.inline.token}}', jsonUser: '{{data.json.user}}', csvName: '{{data.csv.name}}', number: 'n={{data.numbers.value}}', literal: [null, true, 42]}}}), assertions: assertions()}))};
 assert(createK6ConfigSchema(value => createHash('sha256').update(value).digest('hex')).validate(config)); return config;
}

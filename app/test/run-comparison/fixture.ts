import { createHash } from 'node:crypto';
import { sealEngineResult, encodeCanonicalJson } from '@beetle/contracts';
import { validateApi } from '@beetle/contracts/api';
import type { Run, SuiteRevision, RunResultSnapshot, RunMetricKey, RunMetricSeries, RunComparisonRequest } from '@beetle/contracts/api';
import baseRun from '../../../contracts/fixtures/api/valid/run.json' with {type: 'json'};
import baseRevision from '../../../contracts/fixtures/api/valid/suite-revision.json' with {type: 'json'};
import passed from '../../../contracts/fixtures/valid/passed-result.json' with {type: 'json'};
import sample from '../../../contracts/fixtures/api/valid/run-metric-samples.json' with {type: 'json'};
import { createRunComparisonService } from '../../src/application/run-comparison/index.js';
import type { RunComparisonOptions } from '../../src/ports/run-comparison.js';
export const digest = (text: string) => createHash('sha256').update(text).digest('hex');
export const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
export const metric: RunMetricKey = {metric: 'http_req_duration', kind: 'trend', scope: 'execute', tags: {phase: 'execute', request: 'r0'}};
export const context = (signal = new AbortController().signal) => ({signal, deadline: performance.now() + 30000});
export function deferred<T>() {let resolve!: (value: T) => void; const promise = new Promise<T>(pass => {resolve = pass;}); return {promise, resolve};}
export interface ConfigView {
  target: string; secrets: {name: string; provider: string; locator: string; version?: string}[];
  requests: {id: string; name: string; headers: Record<string, string>; assertions: {id: string; kind: string; value: number; required: boolean}[]}[];
}
export function fixture(count = 2) {
  const runs = new Map<string, Run>(); const revisions = new Map<string, SuiteRevision>(); const results = new Map<string, RunResultSnapshot>();
  const calls: string[] = []; const lookups: {id: string; metric: RunMetricKey}[] = [];
  for (let i = 0; i < count; i++) {
    const revision = {...structuredClone(baseRevision), id: uuid(300 + i), ordinal: i + 1} as SuiteRevision;
    const config = revision.config as unknown as ConfigView;
    config.requests[0]!.assertions = [{id: 'status', kind: 'statusEq', value: 200, required: true}];
    revision.digest = digest(encodeCanonicalJson(revision.config, 1048576));
    const checked = validateApi('Run', {...structuredClone(baseRun), id: uuid(100 + i), activeAttemptId: uuid(200 + i), revisionId: revision.id,
      revisionDigest: revision.digest, state: 'finished', outcome: 'passed', validationStatus: 'passed'});
    if (!checked.ok) throw new Error('Invalid run fixture'); const run = checked.value;
    const {seal, ...body} = {...structuredClone(passed), attemptId: run.activeAttemptId,
      organizationId: run.scope.organizationId, workspaceId: run.scope.workspaceId, requiredAssertions: {required: 1, passed: 1, failed: 0, unknown: 0}, thresholds: []};
    void seal;
    const sealed = sealEngineResult(body, '2026-11-12T00:00:00.000Z', digest); if (!sealed.ok) throw new Error('Invalid fixture result');
    runs.set(run.id, run); revisions.set(revision.id, revision); results.set(run.id, {id: run.id, scope: run.scope, activeAttemptId: run.activeAttemptId, result: structuredClone(sealed.value)});
  }
  const request: RunComparisonRequest = {scope: {...baseRun.scope, kind: 'workspace'}, runIds: [...runs.keys()], metric: null};
  const options: RunComparisonOptions = {digest,
    runs: {getRun: async key => {calls.push('run:' + key.id); const value = runs.get(key.id); if (!value) throw new Error('Missing run'); return structuredClone(value);}},
    suites: {getRevision: async key => {calls.push('revision:' + key.id); const value = revisions.get(key.id); if (!value) throw new Error('Missing revision'); return structuredClone(value);}},
    results: {getRunResult: async key => {calls.push('result:' + key.id); const value = results.get(key.id); if (!value) throw new Error('Missing result'); return structuredClone(value);}},
    metrics: {lookupRunMetricSeries: async query => {
      lookups.push({id: query.id, metric: query.metric}); const run = runs.get(query.id)!;
      const series = {...structuredClone(sample.series), ...query.metric, ordinal: 0} as RunMetricSeries;
      return {source: {id: run.id, scope: run.scope, attemptId: run.activeAttemptId, generation: 1, manifestDigest: 'a'.repeat(64),
        availability: 'ready', reason: null, windows: 1, totalSeries: 1, measurementSourceTimeMs: 1800000000000,
        coverage: {complete: true, latePoints: 0, markerDelayDroppedBuckets: 0}}, series};
    }},
  };
  return {runs, revisions, results, request, options, calls, lookups,
    config(index: number) {return revisions.get([...runs.values()][index]!.revisionId)!.config as unknown as ConfigView;},
    repin(index: number) {const run = [...runs.values()][index]!; const revision = revisions.get(run.revisionId)!;
      revision.digest = digest(encodeCanonicalJson(revision.config, 1048576)); run.revisionDigest = revision.digest;},
    service: () => createRunComparisonService(options),
  };
}
export type Fixture = ReturnType<typeof fixture>;

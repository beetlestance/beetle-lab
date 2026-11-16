import assert from 'node:assert/strict';
import type {EngineResult} from '@beetle/contracts';
import type {ApiClient, Run} from '@beetle/contracts/api';
import {pause, value} from '../public-api.js';
import {params} from '../../resources/lifecycle/observations.js';
import type {Case} from './config.js';
export async function settled(api: ApiClient, queued: Run, kind: Case, capture: (evidence: {run: Run; result: EngineResult}) => void) {
 const deadline = performance.now() + 90000;
 for (let calls = 0; calls < 200 && performance.now() < deadline; calls++) {
  const run = value(await api.getRun({params: params(queued)})); assert.equal(run.activeAttemptId, queued.activeAttemptId);
  if (!['finished', 'errored', 'cancelled'].includes(run.state)) {await pause(); continue;}
  assert.equal(run.state, 'finished'); assert.equal(run.validationStatus, 'passed'); assert.equal(run.reason, null);
  const envelope = value(await api.getRunResult({params: params(run)})); const result = envelope.result; assert(result); capture({run, result});
  assert.equal(envelope.activeAttemptId, queued.activeAttemptId); assert.equal(result.execution.status, 'completed');
  const expected = expectations(kind); assert.equal(run.outcome, expected.outcome); assert.equal(result.outcome, expected.outcome);
  assert.equal(result.execution.exitCode, expected.exitCode); assert.equal(result.mode, kind.startsWith('discovery-') ? 'discovery' : 'ordinary');
  if (kind.startsWith('discovery-')) {assert('expectedAbort' in result); assert.deepEqual(result.expectedAbort, {ruleId: 'stop', reached: kind === 'discovery-reached'});}
  if (kind === 'slo') assert(result.thresholds.some(rule => rule.id === 'impossible' && rule.purpose === 'slo' && !rule.passed));
  if (kind === 'assertion') assert.equal(result.requiredAssertions.failed, 1);
  if (kind === 'transport') assert.deepEqual(result.requiredAssertions, {required: 1, passed: 0, failed: 0, unknown: 1});
  return {run, result};
 }
 throw Error('Native parity original did not settle within budget');
}
export function expectations(kind: Case): {outcome: 'passed' | 'failed' | 'inconclusive'; exitCode: number} {
 if (kind === 'transport') return {outcome: 'inconclusive', exitCode: 0};
 if (kind === 'discovery-exhausted') return {outcome: 'inconclusive', exitCode: 0};
 if (kind === 'executors') return {outcome: 'passed', exitCode: 0};
 return {outcome: kind === 'discovery-reached' ? 'passed' : 'failed', exitCode: 99};
}

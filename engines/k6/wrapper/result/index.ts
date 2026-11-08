import { encodeJson, validate } from '@beetle/contracts';
import { assertionEvidence } from './assertions.js';
import { execution, outcome, sealable } from './decision.js';
import { healthEvidence, measurementComplete } from './health.js';
import { thresholdEvidence } from './thresholds.js';
import type { AssertionEvidence, HealthEvidence, K6ResultBody, K6ResultInput, K6ResultMapping, ThresholdEvidence } from './types.js';
export type { K6ResultBody, K6ResultInput, K6ResultMapping } from './types.js';

function freeze(value: unknown): void {
  if (value === null || typeof value !== 'object') return;
  for (const child of Object.values(value)) freeze(child);
  Object.freeze(value);
}
function snapshot(input: K6ResultInput): K6ResultInput {
  // The accepted compiler IR can contain expanded datasets; it is already frozen.
  const { suite, ...evidence } = input;
  const copy = JSON.parse(encodeJson(evidence, 4_194_304)) as Omit<K6ResultInput, 'suite'>;
  const expected = ['organizationId', 'workspaceId', 'attemptId', 'generation'];
  if (Object.keys(copy.scope).length !== expected.length || Object.keys(copy.scope).some(key => !expected.includes(key))) throw new Error('invalid_input');
  return { ...copy, suite };
}
function map(input: K6ResultInput): K6ResultMapping {
  if (!sealable(input)) return Object.freeze({ ok: false, code: 'not_quiescent' });
  const assertions = assertionEvidence(input);
  const health = healthEvidence(input, assertions);
  const thresholds = thresholdEvidence(input);
  const contradictory = assertions.contradictory || health.contradictory;
  const complete = decisionComplete(input, { assertions, thresholds, health, contradictory });
  const state = execution(input, health, contradictory, thresholds);
  const body = { protocolVersion: '1.0', ...input.scope, schemaId: 'https://beetle-lab.dev/contracts/runner/v1/engine-result',
    engineId: 'k6', requiredAssertions: assertions.counts, thresholds: thresholds.verdicts,
    completeness: complete ? 'complete' : input.summary === null && input.metrics === null ? 'missing' : 'partial',
    execution: state, outcome: outcome({ execution: state, assertions, thresholds, health, complete }), artifacts: input.artifacts,
    ...(thresholds.expectedAbort ? { mode: 'discovery', expectedAbort: thresholds.expectedAbort } : { mode: 'ordinary' }) };
  return checked(body, input);
}
function decisionComplete(input: K6ResultInput, evidence: { assertions: AssertionEvidence; thresholds: ThresholdEvidence;
  health: HealthEvidence; contradictory: boolean }): boolean {
  return !evidence.contradictory && evidence.assertions.counts.unknown === 0 && evidence.thresholds.complete && evidence.health.complete
    && measurementComplete(input) && input.process.collection === 'complete' && input.summary?.nativeCollection === 'complete';
}
function checked(body: unknown, input: K6ResultInput): K6ResultMapping {
  // This seal is only a schema witness. It is stripped and never returned/published.
  const candidate = JSON.parse(encodeJson({ ...(body as object),
    seal: { sealedAt: input.terminalObservedAt, sha256: '0'.repeat(64) } }, 1_048_576)) as unknown;
  const validated = validate('EngineResult', candidate);
  if (!validated.ok) return Object.freeze({ ok: false, code: 'invalid_input' });
  const { seal, ...unsealed } = validated.value; void seal;
  const coverage = input.metrics?.windowCoverage;
  const result: K6ResultMapping = { ok: true, body: unsealed as K6ResultBody,
    diagnostics: { windowCoverage: coverage ? { complete: coverage.complete, latePoints: coverage.latePoints,
      markerDelayDroppedBuckets: coverage.markerDelayDroppedBuckets } : null } };
  freeze(result); return result;
}
/** Pure mapping of verified private evidence; no custody, seal or release authority. */
export function mapK6Result(input: K6ResultInput): K6ResultMapping {
  try { return map(snapshot(input)); }
  catch { return Object.freeze({ ok: false, code: 'invalid_input' }); }
}

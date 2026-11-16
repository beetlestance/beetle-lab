import { expect, it } from 'vitest';
import { captureK6Warnings, decodeK6Warnings } from '../src/k6-warnings/index.js';
const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
export function warningFixture() {return {format: 'beetle-k6-warnings', version: 1,
  scope: {organizationId: id, workspaceId: id, attemptId: id, generation: 1},
  native: {coverage: 'complete', insufficientVus: 1, highCardinality: 0, maxDuration: 0, otherWarnings: 0, discardedSegments: 0},
  configuration: {scenarioCount: 1, arrival: {executor: 'constant-arrival-rate', peakIterationsPerSecond: 10, preAllocatedVUs: 1, maxVUs: 2}},
  iteration: {estimate: 100, lower: 90, upper: 110, count: 5}};}
it('detaches bounded evidence and rejects raw fields, contradictions and unsafe counts', () => {
  const input = warningFixture(); const copy = captureK6Warnings(input); input.native.insufficientVus = 9;
  expect(copy.native.insufficientVus).toBe(1); expect(Object.isFrozen(copy.native)).toBe(true);
  for (const change of [
    {...input, secret: 'URL'}, {...input, native: {...input.native, insufficientVus: Number.MAX_SAFE_INTEGER + 1}},
    {...input, native: {...input.native, otherWarnings: 1}},
    {...input, configuration: {...input.configuration, scenarioCount: 2}},
    {...input, configuration: {...input.configuration, arrival: {...input.configuration.arrival, maxVUs: 0}}},
    {...input, iteration: {...input.iteration, lower: 101}}, {...input, scope: {...input.scope, generation: 2}},
  ]) expect(() => captureK6Warnings(change)).toThrow('Warning evidence rejected');
});
it('strict UTF8 and byte boundaries include the published newline', () => {
  const bytes = new TextEncoder().encode(JSON.stringify(warningFixture()) + '\n');
  expect(decodeK6Warnings(bytes).native.insufficientVus).toBe(1);
  for (const bad of [new Uint8Array(4097), Uint8Array.of(255), new TextEncoder().encode('{')]) expect(() => decodeK6Warnings(bad)).toThrow();
});

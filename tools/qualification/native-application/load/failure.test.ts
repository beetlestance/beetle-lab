import {expect, it} from 'vitest';
import {AssertionError} from 'node:assert';
import {publicShortFailure, shortFailure} from './failure.js';
const revision = 'a'.repeat(40); const canary = 'PRIVATE-TOKEN-/private/secret.txt';
it('retains only closed failure coordinates, phase, counts and numeric timing facts', () => {
 const error = new AssertionError({message: canary}); error.stack = canary+'\n at loaded (/private/native-application/load/observe.ts:104:3)';
 const result = publicShortFailure({sourceRevision: revision, architecture: 'arm64', harnessNode: 'v24.22.3', status: 'failed', phase: 'loaded', cleanupVerified: true,
  private: canary, results: {failure: shortFailure(error), loadedPartial: {lastState: 'active', readFailures: 0, series: [[canary], [canary], [canary]],
   calls: [{endpoint: 'run', durationMs: 20, status: 200, body: canary}, {endpoint: 'live', durationMs: 10, status: 503, message: canary}]}}}, revision);
 expect(result.status).toBe('failed'); expect(result.diagnosis).toEqual({code: 'assertion', site: {file: 'observe', line: 104, column: 3}});
 expect(result.windows[1]).toMatchObject({lastState: 'active', sampleCounts: [1, 1, 1]}); expect(JSON.stringify(result)).not.toContain(canary);
});
it('never promotes claimed success, malformed identities, unknown strings or forged source sites', () => {
 const result = publicShortFailure({status: 'passed', phase: canary, architecture: canary, harnessNode: canary, sourceRevision: canary,
  results: {failure: {code: canary, site: {file: canary, line: 1, column: 1}}}}, revision);
 expect(result).toMatchObject({status: 'failed', phase: null, architecture: null, harnessNode: null, sourceRevision: null, diagnosis: {code: 'internal', site: null}});
 expect(JSON.stringify(result)).not.toContain(canary);
});

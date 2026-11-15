import {expect, it} from 'vitest';
import {publicLifecycleOutcome} from './outcome.js';
const canary = 'NEVER-PUBLISH-PRIVATE';
function fixture() {
  return {format: 'beetle-active-recovery', version: 1, mode: 'cancel', phase: 'offline-custody', status: 'passed', cleanupVerified: true,
    revision: 'a'.repeat(40), architecture: 'amd64', imageIds: Object.fromEntries(['frontend', 'backend', 'agent', 'installer', 'engine', 'offline'].map(role => [role, 'sha256:' + 'b'.repeat(64)])),
    failure: canary, root: canary, results: [{kind: 'cancel', sameOriginal: true, workRequests: 11, resourceStatus: 'passed', secret: canary,
      summaries: [{samples: 5, reason: null, secret: canary, source: 'docker-stats', scope: 'container', outputBytes: null, cpuMillis: 400, peakMemoryBytes: 70000000, peakPids: 20}]}, {kind: 'custody', executionReleased: true, originalAllocationChargedBytes: 67174400, exit: {secret: canary}}]};
}
it('publishes only fixed image identities, counts and lifecycle facts', () => {
  const value = publicLifecycleOutcome(fixture()); expect(value.status).toBe('passed');
  expect(JSON.stringify(value)).not.toContain(canary); expect(value.originalAllocations).toEqual([67174400]);
});
it('cannot promote missing cases, failed cleanup, malformed identity or incomplete resource evidence', () => {
  for (const input of [{...fixture(), results: []}, {...fixture(), cleanupVerified: false}, {...fixture(), revision: canary},
    {...fixture(), mode: 'crashes'}, {...fixture(), imageIds: {}}, {...fixture(), status: 'failed'}]) expect(publicLifecycleOutcome(input).status).toBe('failed');
});

it('reduces diagnostic stacks and arbitrary fields to a known site and numeric location', () => {
  const value = publicLifecycleOutcome({...fixture(), status: 'failed', diagnosis: {code: 'assertion',
    site: {file: 'active', line: 45, column: 2, secret: canary}, stack: canary}});
  expect(value.diagnosis).toEqual({code: 'assertion', site: {file: 'active', line: 45, column: 2}});
  expect(JSON.stringify(value)).not.toContain(canary);
});

it('rejects contradictory counts and summary placeholders rather than promoting them', () => {
  const original = fixture();
  const cancellation = original.results[0]!;
  for (const patch of [{workRequests: 40}, {workRequests: 0}, {summaries: [{}]},
    {summaries: [{samples: 0}]}, {summaries: [{samples: 5, source: 'docker-stats', scope: 'container', outputBytes: null}]}]) {
    expect(publicLifecycleOutcome({...original, results: [{...cancellation, ...patch}, original.results[1]]}).status).toBe('failed');
  }
  const crashes = {...original, mode: 'crashes', results: [{...cancellation, kind: 'backend', workRequests: 0},
    {...cancellation, kind: 'agent', workRequests: 40}, original.results[1], original.results[1]]};
  expect(publicLifecycleOutcome(crashes).status).toBe('failed');
});

import { createHash } from 'node:crypto';
import { expect, it } from 'vitest';
import { captureLiveMetricSnapshot, liveMetricSubsetText } from '../api/index.js';
import { validatePrimitive } from '../validate.js';
import { createK6LiveApproval } from './index.js';
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
function input() {
  return {source: {requests: [{id: 'one', assertions: [{id: 'status'}]}]},
    scope: {organizationId: '00000000-0000-4000-8000-000000000001', workspaceId: '00000000-0000-4000-8000-000000000002',
      attemptId: '00000000-0000-4000-8000-000000000003', generation: 1},
    assignment: {specDigest: '1'.repeat(64), intentDigest: '2'.repeat(64)}, hash};
}
it('assigns a stable validated producer UUID and approved frozen subset before any runtime effects', () => {
  const source = input(); const approval = createK6LiveApproval(source);
  expect(approval.producerEpoch).toBe('83100015-5f12-80d2-a421-7b5ef4c84d14');
  expect(hash(liveMetricSubsetText(approval.subset))).toBe('4f0e1d213eed06264bf8554dd7f5791c6cee1c6f4e6452a20c0a9dce5cca3ee7');
  expect(createK6LiveApproval(input())).toEqual(approval); expect(validatePrimitive('uuid', approval.producerEpoch).ok).toBe(true);
  expect(approval.subset.selected[0]).toEqual({ordinal: 0, metric: 'http_req_duration', kind: 'trend', scope: 'execute', tags: {phase: 'execute', request: 'r0'}});
  expect(approval.subset.selected.map(row => row.metric)).toEqual(expect.arrayContaining(['http_req_failed', 'vus', 'dropped_iterations', 'beetle_requests']));
  expect(approval.subset.selected.every(row => ['execute', 'engine'].includes(row.scope) && row.tags.phase !== 'prepare')).toBe(true);
  expect(Object.isFrozen(approval.subset.selected[0]?.tags)).toBe(true); expect(Object.isFrozen(approval.scope)).toBe(true);
  source.scope.generation = 2; source.source.requests[0]!.id = 'changed'; expect(approval.scope.generation).toBe(1);
  expect(() => captureLiveMetricSnapshot({version: 1, ...approval, subsetDigest: hash(liveMetricSubsetText(approval.subset)),
    sourceSequence: 1, publishedSequence: 1, coalescedWindows: 0, capturedAtMs: 1000, publishedAtMs: 1000,
    startTimeMs: 0, endTimeMs: 1000, upstreamCoverage: 'unknown', series: []}, hash)).not.toThrow();
});
it('binds every unique launch field and canonicalizes UUID casing without changing authority', () => {
  const base = input(); const epoch = createK6LiveApproval(base).producerEpoch;
  for (const assignment of [{...base.assignment, specDigest: '3'.repeat(64)}, {...base.assignment, intentDigest: '3'.repeat(64)}]) {
    expect(createK6LiveApproval({...base, assignment}).producerEpoch).not.toBe(epoch);
  }
  for (const scope of [{...base.scope, generation: 2}, {...base.scope, attemptId: '00000000-0000-4000-8000-000000000004'},
    {...base.scope, organizationId: '00000000-0000-4000-8000-000000000005'}, {...base.scope, workspaceId: '00000000-0000-4000-8000-000000000006'}]) {
    expect(createK6LiveApproval({...base, scope}).producerEpoch).not.toBe(epoch);
  }
  const withHex = {...base, scope: {...base.scope, attemptId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'}};
  expect(createK6LiveApproval(withHex)).toEqual(createK6LiveApproval({...withHex, scope: {...withHex.scope, attemptId: withHex.scope.attemptId.toUpperCase()}}));
});
it('rejects invalid scope, assignment and hash capabilities with fixed errors', () => {
  const base = input();
  expect(() => createK6LiveApproval({...base, assignment: {...base.assignment, specDigest: 'invalid'}})).toThrow('K6 live approval rejected');
  expect(() => createK6LiveApproval({...base, scope: {...base.scope, generation: 0}})).toThrow();
  expect(() => createK6LiveApproval({...base, hash: () => 'invalid'})).toThrow();
});

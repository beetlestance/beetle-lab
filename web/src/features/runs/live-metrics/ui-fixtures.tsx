import { act } from '@testing-library/react';
import type { ApiClient, Run } from '@beetle/contracts/api';
import { ApiContext } from '../../../app/api.js';
import { testClient } from '../../../app/test-fixtures.js';
import { run } from '../test-fixtures.js';
import { RunLiveMetrics } from './index.js';
import type { LiveMetricReads } from './read.js';
import { frame, latest } from './fixtures.js';
export { deferred } from './fixtures.js';
export const session = () => testClient(async () => {throw new Error('Unexpected metadata request');}).client;
export const activeRun = (): Run => ({...run(), state: 'active'});
export function value(current = activeRun(), count = 42, sequence = 1) {
  const now = Date.now(); const selected = frame().subset.selected[0]!;
  const snapshot = frame({scope: {organizationId: current.scope.organizationId, workspaceId: current.scope.workspaceId,
    attemptId: current.activeAttemptId, generation: 1}, publishedSequence: sequence, sourceSequence: sequence,
    capturedAtMs: now, publishedAtMs: now, startTimeMs: now - 1000, endTimeMs: now,
    series: [{...selected, unit: 'count', total: {kind: 'counter', sum: count}}]});
  return {...latest(snapshot, performance.now(), now), fingerprint: count.toString(16).padStart(64, '0')};
}
export function surface(api: ApiClient, current: Run, reads: Pick<LiveMetricReads, 'read'>) {
  return <ApiContext.Provider value={api}><RunLiveMetrics run={current} scope={current.scope} runId={current.id} reads={reads} /></ApiContext.Provider>;
}
export async function flush() {await act(async () => {for (let turn = 0; turn < 12; turn++) await Promise.resolve();});}

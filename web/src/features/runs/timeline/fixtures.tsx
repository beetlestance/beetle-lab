import { render } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { captureRunEventCursor, encodeRunEventCursor } from '@beetle/contracts/api';
import type { ApiClient, Run, RunEventPage } from '@beetle/contracts/api';
import { ApiContext } from '../../../app/api.js';
import { createQueryClient } from '../../../app/queries.js';
import { run } from '../test-fixtures.js';
import { ExecutionActivity } from './index.js';
import type { Event } from './projection.js';
export { run, runId, ids, json, deferred } from '../test-fixtures.js';
export { testClient } from '../../../app/test-fixtures.js';
export function event(seq: number, current = run()): Extract<Event, { kind: 'runtime.started' }> {
  return { version: '1.0', organizationId: current.scope.organizationId, workspaceId: current.scope.workspaceId,
    attemptId: current.activeAttemptId, generation: 1, seq, phase: 'execute', observedAt: '2026-11-10T00:00:00.000Z',
    source: 'agent', kind: 'runtime.started', payload: { runtimeId: 'private-runtime-canary' } };
}
export function page(input: { after?: number; through?: number; limit?: number; current?: Run } = {}): RunEventPage {
  const { after = 0, through = 0, limit = 100, current = run() } = input;
  const items = Array.from({ length: Math.min(through - after, limit) }, (_, index) => event(after + index + 1, current));
  const resumeCursor = encodeRunEventCursor({ organizationId: current.scope.organizationId, workspaceId: current.scope.workspaceId, runId: current.id,
    attemptId: current.activeAttemptId, generation: 1, afterSeq: after + items.length });
  return { id: current.id, scope: current.scope, activeAttemptId: current.activeAttemptId, generation: 1,
    afterSeq: after, durableThrough: through, coverage: through === 0 ? 'pending' : 'contiguous', blockedReason: null,
    retainedStartSeq: null, items, resumeCursor, nextCursor: after + items.length < through ? resumeCursor : null };
}
export function requested(path: string) {
  const url = new URL(path, 'http://localhost'); const cursor = url.searchParams.get('cursor');
  return { after: cursor ? captureRunEventCursor(cursor).afterSeq : 0, limit: Number(url.searchParams.get('limit')) };
}
export function mountActivity(api: ApiClient, initial = run(), terminal = false) {
  const client = createQueryClient();
  function surface(current: Run, done: boolean, source: ApiClient) {
    return <ApiContext.Provider value={source}><QueryClientProvider client={client}>
      <ExecutionActivity key={`${current.scope.organizationId}/${current.scope.workspaceId}/${current.id}/${current.activeAttemptId}`}
        run={current} terminal={done} />
    </QueryClientProvider></ApiContext.Provider>;
  }
  const view = render(surface(initial, terminal, api));
  return { ...view, client, select: (current: Run, done = false, source = api) => view.rerender(surface(current, done, source)) };
}

import { expect, it, vi } from 'vitest';
import type { RunComparisonService } from '../../../src/ports/run-comparison.js';
import { fixture, deferred } from '../../run-comparison/fixture.js';
import { httpFixture } from './fixture.js';
it('retains the one HTTP credit through an aborted actual metadata original and drains shutdown before reuse', async () => {
  const f = fixture(); const hold = deferred<void>(); const issued = deferred<void>(); const read = f.options.runs.getRun;
  f.options.runs.getRun = async key => {issued.resolve(); await hold.promise; return read(key);};
  const actual = f.service(); let invokes = 0; let signal: AbortSignal | undefined;
  const wrapped: RunComparisonService = {compare(request, context) {invokes++; signal = context.signal; return actual.compare(request, context);}, close: () => actual.close()};
  const http = await httpFixture(wrapped); const controller = new AbortController();
  const params = {organizationId: f.request.scope.organizationId, workspaceId: f.request.scope.workspaceId};
  try {
    const pending = http.client.compareRuns({params, body: f.request, signal: controller.signal});
    await issued.promise; controller.abort(); expect(await pending).toMatchObject({ok: false});
    await vi.waitFor(() => expect(signal?.aborted).toBe(true));
    const second = await http.client.compareRuns({params, body: f.request});
    expect(second).toMatchObject({ok: false, error: {kind: 'protocol', status: 503}}); expect(invokes).toBe(1);
    const close = http.routes.close(); let closed = false; void close.then(() => {closed = true;}); await Promise.resolve(); expect(closed).toBe(false);
    hold.resolve(); await close; expect(f.calls).toHaveLength(1); expect(f.lookups).toEqual([]);
  } finally {hold.resolve(); await http.close();}
});

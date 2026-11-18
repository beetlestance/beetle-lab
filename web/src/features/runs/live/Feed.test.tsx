// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ApiContext } from '../../../app/api.js';
import { activeRun, flush, session, value } from '../live-metrics/ui-fixtures.js';
import type { LiveMetricReads } from '../live-metrics/read.js';
import type { Run } from '@beetle/contracts/api';
import { LiveFeed } from './Feed.js';
beforeEach(() => {
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
function mount(selection: 'same' | 'other' | 'invalid') {
  const current = activeRun();
  current.id = 'abcdefab-cdef-4abc-8def-abcdefabcdef';
  current.scope = {
    kind: 'workspace',
    organizationId: 'abcdefab-cdef-4abc-8def-abcdefabcdea',
    workspaceId: 'abcdefab-cdef-4abc-8def-abcdefabcdeb',
  };
  const read = vi.fn<LiveMetricReads['read']>().mockResolvedValue(value(current));
  const scope = {
    organizationId: current.scope.organizationId.toUpperCase(),
    workspaceId: current.scope.workspaceId.toUpperCase(),
  };
  if (selection === 'other') scope.workspaceId = 'abcdefab-cdef-4abc-8def-abcdefabcdec';
  const run = selection === 'invalid' ? ({ id: current.id } as Run) : current;
  render(
    <ApiContext.Provider value={session()}>
      <LiveFeed
        run={run}
        scope={scope}
        runId={current.id.toUpperCase()}
        enabled
        onState={() => undefined}
        reads={{ read }}
      />
    </ApiContext.Provider>,
  );
  return read;
}
it('starts a polling lease when route UUIDs differ only by case', async () => {
  const read = mount('same');
  await flush();
  expect(read).toHaveBeenCalledTimes(1);
});
it.each(['other', 'invalid'] as const)('does not issue a read for %s selection', async (selection) => {
  const read = mount(selection);
  await flush();
  expect(read).not.toHaveBeenCalled();
});

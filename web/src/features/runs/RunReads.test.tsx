// @vitest-environment jsdom
import { StrictMode, useEffect, useState } from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { ApiContext, useApi } from '../../app/api.js';
import { testClient, json } from '../../app/test-fixtures.js';
import { resultSnapshot, run } from './test-fixtures.js';
import { RunReads } from './RunReads.js';
afterEach(cleanup);
function Probe() {
  const api = useApi(); const [state, setState] = useState('pending');
  useEffect(() => {
    const controller = new AbortController(); const current = run();
    void api.getRunResult({ params: { organizationId: current.scope.organizationId,
      workspaceId: current.scope.workspaceId, runId: current.id }, signal: controller.signal })
      .then(result => { if (!controller.signal.aborted) setState(result.ok ? 'ready' : 'failed'); },
        () => { if (!controller.signal.aborted) setState('failed'); });
    return () => controller.abort();
  }, [api]);
  return <output>{state}</output>;
}
it('recreates effect-owned admission through StrictMode cleanup and setup', async () => {
  const api = testClient(() => json(resultSnapshot()));
  render(<StrictMode><ApiContext.Provider value={api.client}><RunReads><Probe /></RunReads></ApiContext.Provider></StrictMode>);
  expect(await screen.findByText('ready')).toBeTruthy();
});

// @vitest-environment jsdom
import { StrictMode, useEffect, useState } from 'react';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { ApiContext, useApi } from '../../app/api.js';
import { testClient, json } from '../../app/test-fixtures.js';
import { resultSnapshot, run, revision } from './test-fixtures.js';
import { RunReads } from './RunReads.js';
afterEach(cleanup);
function Probe() {
  const api = useApi();
  const [state, setState] = useState('pending');
  useEffect(() => {
    const controller = new AbortController();
    const current = run();
    void api
      .getRunResult({
        params: {
          organizationId: current.scope.organizationId,
          workspaceId: current.scope.workspaceId,
          runId: current.id,
        },
        signal: controller.signal,
      })
      .then(
        (result) => {
          if (!controller.signal.aborted) setState(result.ok ? 'ready' : 'failed');
        },
        () => {
          if (!controller.signal.aborted) setState('failed');
        },
      );
    return () => controller.abort();
  }, [api]);
  return <output>{state}</output>;
}
it('recreates effect-owned admission through StrictMode cleanup and setup', async () => {
  const api = testClient(() => json(resultSnapshot()));
  render(
    <StrictMode>
      <ApiContext.Provider value={api.client}>
        <RunReads>
          <Probe />
        </RunReads>
      </ApiContext.Provider>
    </StrictMode>,
  );
  expect(await screen.findByText('ready')).toBeTruthy();
});

function MetadataBurst() {
  const api = useApi();
  const [state, setState] = useState('pending');
  useEffect(() => {
    const controller = new AbortController();
    const current = run();
    const params = { organizationId: current.scope.organizationId, workspaceId: current.scope.workspaceId };
    void Promise.all([
      api.getSuite({ params: { ...params, suiteId: current.suiteId }, signal: controller.signal }),
      api.getSuiteRevision({ params: { ...params, revisionId: current.revisionId }, signal: controller.signal }),
      api.getRunResult({ params: { ...params, runId: current.id }, signal: controller.signal }),
    ]).then(
      (replies) => {
        if (!controller.signal.aborted) setState(replies.every((reply) => reply.ok) ? 'ready' : 'failed');
      },
      () => {
        if (!controller.signal.aborted) setState('failed');
      },
    );
    return () => controller.abort();
  }, [api]);
  return <output>{state}</output>;
}
it('serializes suite, revision and result metadata in the same physical read lane', async () => {
  const current = run();
  let active = 0;
  let peak = 0;
  const releases: Array<() => void> = [];
  const fixture = testClient((request) => {
    active++;
    peak = Math.max(peak, active);
    const body = request.path.endsWith('/result')
      ? resultSnapshot()
      : request.path.includes('/revisions/')
        ? revision()
        : {
            id: current.suiteId,
            scope: current.scope,
            name: 'Owned suite',
            version: 1,
            folderId: '44444444-4444-4444-8444-444444444444',
            currentRevisionId: current.revisionId,
          };
    return new Promise<Response>((resolve) =>
      releases.push(() => {
        active--;
        resolve(json(body));
      }),
    );
  });
  render(
    <ApiContext.Provider value={fixture.client}>
      <RunReads>
        <MetadataBurst />
      </RunReads>
    </ApiContext.Provider>,
  );
  await waitFor(() => expect(fixture.records).toHaveLength(1));
  for (let index = 0; index < 3; index++) {
    await waitFor(() => expect(releases).toHaveLength(index + 1));
    await act(async () => releases[index]!());
  }
  expect(await screen.findByText('ready')).toBeTruthy();
  expect(peak).toBe(1);
  expect(fixture.records).toHaveLength(3);
});

function MetricAndMetadata() {
  const api = useApi();
  const [started, setStarted] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    const current = run();
    void api.getRunMetricOverview({
      params: {
        organizationId: current.scope.organizationId,
        workspaceId: current.scope.workspaceId,
        runId: current.id,
        attemptId: current.activeAttemptId!,
      },
      signal: controller.signal,
    });
    setStarted(true);
    return () => controller.abort();
  }, [api]);
  return started ? <MetadataBurst /> : null;
}
it('keeps metadata usable while a metric original remains physically active', async () => {
  const current = run();
  let release: (() => void) | undefined;
  const fixture = testClient((request) => {
    if (request.path.includes('/metrics/'))
      return new Promise<Response>((resolve) => {
        release = () => resolve(json({}));
      });
    return json(
      request.path.endsWith('/result')
        ? resultSnapshot()
        : request.path.includes('/revisions/')
          ? revision()
          : {
              id: current.suiteId,
              scope: current.scope,
              name: 'Owned suite',
              version: 1,
              folderId: '44444444-4444-4444-8444-444444444444',
              currentRevisionId: current.revisionId,
            },
    );
  });
  render(
    <ApiContext.Provider value={fixture.client}>
      <RunReads>
        <MetricAndMetadata />
      </RunReads>
    </ApiContext.Provider>,
  );
  try {
    await waitFor(() => expect(release).toBeTypeOf('function'));
    expect(await screen.findByText('ready')).toBeTruthy();
    expect(fixture.records).toHaveLength(4);
  } finally {
    await act(async () => release?.());
  }
});

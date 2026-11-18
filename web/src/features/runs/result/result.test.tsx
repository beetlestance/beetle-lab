// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, expect, it } from 'vitest';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import metricOverview from '../../../../../contracts/fixtures/api/valid/run-metric-overview.json' with { type: 'json' };
import { pendingRunHistorySummary } from '@beetle/contracts/api';
import type { Run, RunHistorySummary } from '@beetle/contracts/api';
import { routes } from '../../../app/routes.js';
import { suite } from '../history-fixtures.js';
import { apiError, ids, json, mount, resultSnapshot, revision, run, runId, testClient } from '../test-fixtures.js';

afterEach(cleanup);
const path = routes.run(ids.a, ids.workspace, runId);
type Request = Parameters<Parameters<typeof testClient>[0]>[0];

function finished(patch: Partial<Run> = {}): Run {
  return { ...run(), state: 'finished', outcome: 'passed', validationStatus: 'passed', ...patch };
}
function summary(current: Run): RunHistorySummary {
  return {
    ...pendingRunHistorySummary(current),
    availability: 'ready',
    source: {
      generation: 1,
      manifestDigest: 'a'.repeat(64),
      numericArtifactId: ids.request,
      numericSha256: 'b'.repeat(64),
      numericVersion: 4,
      measurementSourceTimeMs: 1000,
      coverage: { complete: true, latePoints: 0, markerDelayDroppedBuckets: 0 },
    },
    testDurationMs: 2000,
    requestCount: 8,
    requestsPerSecond: 4,
    httpFailures: 2,
    httpSamples: 8,
    httpFailureRatio: 0.25,
    httpP95: { source: 'histogram-estimate', scale: 4, estimate: 10, lower: 9, upper: 11 },
    publishedArtifactBytes: 1536,
    retainedLogicalBytes: 67584,
    metadataAllowanceBytes: 65536,
  };
}
/** Routes the result view's bounded reads; `extra` answers writes and overrides. */
function fixture(current: Run, extra: (request: Request) => Response | undefined = () => undefined) {
  let latest = current;
  const client = testClient((request) => {
    const answer = extra(request);
    if (answer) return answer;
    if (request.path.endsWith('/result')) return json(resultSnapshot(latest));
    if (request.path.includes('/runs?'))
      return json({ scope: latest.scope, items: [latest], summaries: [summary(latest)], nextCursor: null });
    if (request.path.includes('/suites/')) return json({ ...suite(), name: 'checkout-steady' });
    if (request.path.includes('/revisions/')) return json(revision());
    return json(latest);
  });
  return { ...client, set: (next: Run) => (latest = next) };
}

it('shows the verdict title, whole-run tiles and actions for a passed run', async () => {
  const f = fixture(finished());
  mount(f.client, path);
  expect(await screen.findByRole('heading', { name: 'checkout-steady passed' })).toBeVisible();
  expect(await screen.findByText('Held 4 requests a second for 2 seconds.', { exact: false })).toBeVisible();
  const tiles = await screen.findByText('requests');
  expect(tiles.parentElement).toHaveTextContent('8');
  expect(screen.getByRole('button', { name: 'Run again' })).toBeEnabled();
  expect(screen.getByRole('button', { name: 'Pin this run' })).toHaveAttribute('aria-pressed', 'false');
  expect(screen.getByText(/No engine result was published/)).toBeVisible();
  expect(screen.getByRole('tab', { name: 'Report' })).toHaveAttribute('aria-selected', 'true');
  expect(f.records.filter((record) => record.method !== 'GET')).toHaveLength(0);
});

it('pins from the receipt, shows the toast and re-reads the run', async () => {
  const f = fixture(finished(), (request) => {
    if (request.path.endsWith('/pin'))
      return json({
        id: runId,
        scope: finished().scope,
        requestId: (request.body as { requestId: string }).requestId,
        pinned: true,
        pinnedAt: '2026-11-18T10:00:00.000Z',
      });
    return undefined;
  });
  mount(f.client, path);
  fireEvent.click(await screen.findByRole('button', { name: 'Pin this run' }));
  expect(await screen.findByRole('button', { name: '✓ Pinned' })).toHaveAttribute('aria-pressed', 'true');
  expect(await screen.findByText(`Run ${runId.slice(0, 4)} is pinned`)).toBeVisible();
  const post = f.records.find((record) => record.method === 'POST')!;
  expect(post.path).toMatch(/\/runs\/[0-9a-f-]+\/pin$/);
  expect(post.body).toMatchObject({ scope: finished().scope });
});

it.each([
  ['pin_limit', /256 runs are pinned in this workspace/],
  ['cleanup_in_progress', /being removed, so it can no longer be pinned/],
] as const)('explains a %s refusal without changing the pin state', async (reason, text) => {
  const f = fixture(finished(), (request) =>
    request.path.endsWith('/pin') ? json({ ...apiError('conflict'), reason }, 409) : undefined,
  );
  mount(f.client, path);
  fireEvent.click(await screen.findByRole('button', { name: 'Pin this run' }));
  expect(await screen.findByText(text)).toBeVisible();
  const button = screen.getByRole('button', { name: 'Pin this run' });
  expect(button).toHaveAttribute('aria-pressed', 'false');
  if (reason === 'pin_limit')
    expect(screen.getByRole('link', { name: 'See pinned runs' })).toHaveAttribute(
      'href',
      expect.stringContaining('pinned=true'),
    );
  else expect(button).toBeDisabled();
});

it('hides every action in a restored read-only session and shows the history banner', async () => {
  const f = fixture(finished());
  mount(f.client, path, {
    readOnly: true,
    restoredBackup: { backupId: ids.request, createdAt: '2026-11-12T02:00:00.000Z' },
  });
  expect(await screen.findByText(/You are looking at a restored backup from/)).toBeVisible();
  expect(screen.getByText('Read-only history: actions are unavailable.')).toBeVisible();
  expect(screen.queryByRole('button', { name: 'Run again' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Add a note' })).not.toBeInTheDocument();
  expect(f.records.some((record) => record.path.endsWith('/auth/session'))).toBe(false);
});

it('saves a note with its version and explains a stale-version conflict', async () => {
  let saves = 0;
  const f = fixture(finished({ noteVersion: 0 }), (request) => {
    if (!request.path.endsWith('/note')) return undefined;
    if (++saves === 1) return json(finished({ note: 'After the cache flush', noteVersion: 1 }));
    return json(apiError('conflict'), 409);
  });
  mount(f.client, path);
  fireEvent.click(await screen.findByRole('button', { name: 'Add a note' }));
  fireEvent.change(screen.getByLabelText('Run note'), { target: { value: '  After the cache flush ' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save note' }));
  expect(await screen.findByText('After the cache flush', { selector: 'p' })).toBeVisible();
  expect(f.records.find((record) => record.path.endsWith('/note'))!.body).toMatchObject({
    expectedNoteVersion: 0,
    note: 'After the cache flush',
  });
  fireEvent.click(screen.getByRole('button', { name: 'Edit note' }));
  fireEvent.click(screen.getByRole('button', { name: 'Clear note' }));
  expect(await screen.findByText(/The note changed elsewhere/)).toBeVisible();
  expect(f.records.filter((record) => record.path.endsWith('/note')).at(-1)!.body).toMatchObject({
    expectedNoteVersion: 1,
    note: null,
  });
});

it('starts the same revision again with the run budget and policy', async () => {
  const current = finished();
  const f = fixture(current, (request) =>
    request.method === 'POST' && request.path.endsWith('/runs')
      ? json({ ...run(), id: ids.request, state: 'queued' }, 201)
      : undefined,
  );
  mount(f.client, path);
  fireEvent.click(await screen.findByRole('button', { name: 'Run again' }));
  await waitFor(() => expect(f.records.some((record) => record.method === 'POST')).toBe(true));
  expect(f.records.find((record) => record.method === 'POST')!.body).toMatchObject({
    revisionId: current.revisionId,
    engineProfile: current.engine.profileId,
    budget: current.budget,
    executionPolicy: current.executionPolicy,
  });
});

it('offers Unpin before deletion for a pinned run and the retention preview otherwise', async () => {
  const f = fixture(finished({ pinned: true, pinnedAt: '2026-11-18T10:00:00.000Z' }));
  mount(f.client, path);
  fireEvent.click(await screen.findByRole('button', { name: 'Delete run…' }));
  const dialog = await screen.findByRole('dialog');
  expect(within(dialog).getByText(/is pinned, so retention keeps it/)).toBeVisible();
  expect(within(dialog).getByRole('button', { name: `Unpin run ${runId.slice(0, 4)}` })).toBeEnabled();
  fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  cleanup();
  const g = fixture(finished());
  mount(g.client, path);
  fireEvent.click(await screen.findByRole('button', { name: 'Delete run…' }));
  expect(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Delete this run…' })).toBeVisible();
  expect(g.records.filter((record) => record.method !== 'GET')).toHaveLength(0);
});

it('consumes the scoped metric overview without issuing any write or per-endpoint read',async()=>{
 const current=finished();const f=fixture(current,request=>request.path.endsWith('/metrics/overview')?json({...metricOverview,id:current.id,scope:current.scope,attemptId:current.activeAttemptId}):undefined);
 mount(f.client,path);
 expect(await screen.findByText('of checks passed')).toBeVisible();
 expect(screen.getByRole('table',{name:'Whole-run endpoint measurements'})).toBeVisible();
 expect(f.records.filter(record=>record.path.endsWith('/metrics/overview'))).toHaveLength(1);
 expect(f.records.filter(record=>record.method!=='GET')).toHaveLength(0);
});

it('lets an operator recheck pending measurements without automatically polling or starting work',async()=>{
 const current=finished();let ready=false;
 const complete={...metricOverview,id:current.id,scope:current.scope,attemptId:current.activeAttemptId};
 const pending={...complete,availability:'pending',source:null,testDurationMs:null,requestCount:null,requestsPerSecond:null,
  failure:null,latency:null,checks:null,droppedIterations:null,endpoints:[],omittedEndpoints:0};
 const f=fixture(current,request=>request.path.endsWith('/metrics/overview')?json(ready?complete:pending):undefined);
 mount(f.client,path);
 const check=await screen.findByRole('button',{name:'Check measurements'});
 expect(screen.queryByText('of checks passed')).not.toBeInTheDocument();
 expect(f.records.filter(record=>record.path.endsWith('/metrics/overview'))).toHaveLength(1);
 ready=true;fireEvent.click(check);
 expect(await screen.findByText('of checks passed')).toBeVisible();
 expect(f.records.filter(record=>record.path.endsWith('/metrics/overview'))).toHaveLength(2);
 expect(f.records.filter(record=>record.method!=='GET')).toHaveLength(0);
});

it('refuses saved threshold metadata whose revision digest differs from the accepted run',async()=>{
 const current=finished();const wrong={...revision(),digest:'f'.repeat(64)};
 const f=fixture(current,request=>request.path.includes('/revisions/')?json(wrong):undefined);
 mount(f.client,path);
 expect(await screen.findByText('Revision details could not be loaded.')).toBeVisible();
 expect(screen.queryByText(/saved.*by/i)).not.toBeInTheDocument();
});

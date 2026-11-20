// @vitest-environment jsdom
import nativeTemplate from '../../../../../contracts/fixtures/valid/passed-result.json' with { type: 'json' };
import recoveredData from '../../../../../contracts/fixtures/api/valid/live-target-history.json' with { type: 'json' };
import chartData from '../../../../../contracts/fixtures/api/valid/run-chart-history.json' with { type: 'json' };
import '@testing-library/jest-dom/vitest';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import metricOverview from '../../../../../contracts/fixtures/api/valid/run-metric-overview.json' with { type: 'json' };
import { pendingRunHistorySummary } from '@beetle/contracts/api';
import type { Run, RunHistorySummary } from '@beetle/contracts/api';
import { routes } from '../../../app/routes.js';
import { suite } from '../history-fixtures.js';
import { apiError, deferred, ids, json, mount, resultSnapshot, revision, run, runId, testClient } from '../test-fixtures.js';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
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
function fixture(current: Run, extra: (request: Request) => Response | Promise<Response> | undefined = () => undefined) {
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
  expect(await screen.findByText('Averaged 4 requests a second over 2 seconds.', { exact: false })).toBeVisible();
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
  expect(await screen.findByText(`Run ${runId.slice(0, 4)} is pinned. Retention will not remove it.`)).toBeVisible();
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

it.each([undefined, 'https://beetle.example.test'])('keeps restored Results read-only with live destination %s', async (liveOrigin) => {
  const f = fixture(finished());
  mount(f.client, path, {
    readOnly: true,
    restoredBackup: { backupId: ids.request, createdAt: '2026-11-12T02:00:00.000Z' },
    liveOrigin,
  });
  expect(await screen.findByText(/You are looking at a restored backup from/)).toBeVisible();
  const live = screen.queryByRole('link', { name: 'Back to live' });
  if (liveOrigin) {
    expect(live).toHaveAttribute('href', liveOrigin);
    expect(live).toHaveAttribute('referrerpolicy', 'no-referrer');
  } else {
    expect(live).not.toBeInTheDocument();
  }
  expect(screen.getByText('Read-only history: changes are unavailable.')).toBeVisible();
  expect(screen.getByRole('button', { name: 'Download' })).toBeVisible();
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

it.each([false, true])('sequences the first chart read behind its overview (overview fails: %s)', async (fail) => {
  const current = finished();
  const response = deferred<Response>();
  const fields = { id: current.id, scope: current.scope, attemptId: current.activeAttemptId };
  const f = fixture(current, (request) => {
    if (request.path.endsWith('/metrics/overview')) return response.promise;
    if (request.path.endsWith('/metrics/chart-history')) return json({ ...chartData, ...fields });
    return undefined;
  });
  mount(f.client, path);
  await screen.findByText('Reading whole-run measurements…');
  const chartReads = () => f.records.filter((read) => read.path.endsWith('/metrics/chart-history'));
  expect(chartReads()).toHaveLength(0);
  response.resolve(fail ? json(apiError('capacity_unavailable'), 503) : json({ ...metricOverview, ...fields }));
  await screen.findByRole('img', { name: /Recorded p95 latency/ });
  expect(chartReads()).toHaveLength(1);
  if (fail) expect(screen.getByRole('button', { name: 'Retry measurements' })).toBeVisible();
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

it('shows recorded charts with a whole-run switch and keeps per-series browsing on demand',async()=>{
 const current=finished();const f=fixture(current,request=>request.path.endsWith('/metrics/chart-history')?json({...chartData,id:current.id,scope:current.scope,attemptId:current.activeAttemptId}):undefined);
 mount(f.client,path);
 expect(await screen.findByRole('heading',{name:'The whole run'})).toBeVisible();
 expect(screen.getByRole('heading',{name:'Requests and virtual users'})).toBeVisible();
 expect(f.records.filter(record=>record.path.endsWith('/metrics/chart-history'))).toHaveLength(1);
 expect(f.records.filter(record=>/\/metrics\?/.test(record.path))).toHaveLength(0);
 fireEvent.click(screen.getByRole('radio',{name:'Requests'}));
 expect(screen.getByRole('img',{name:/Recorded requests per one-second window/})).toBeVisible();
 expect(f.records.filter(record=>record.path.endsWith('/metrics/chart-history'))).toHaveLength(1);
});

it('recovers a failed recorded-chart read explicitly without per-series fanout',async()=>{
 const current=finished();let fail=true;
 const f=fixture(current,request=>request.path.endsWith('/metrics/chart-history')?(fail?json(apiError('capacity_unavailable'),503):json({...chartData,id:current.id,scope:current.scope,attemptId:current.activeAttemptId})):undefined);
 mount(f.client,path);
 const retry=await screen.findByRole('button',{name:'Retry recorded charts'});
 expect(screen.queryByRole('heading',{name:'The whole run'})).not.toBeInTheDocument();
 fail=false;fireEvent.click(retry);
 expect(await screen.findByRole('heading',{name:'The whole run'})).toBeVisible();
 expect(f.records.filter(record=>record.path.endsWith('/metrics/chart-history'))).toHaveLength(2);
 expect(f.records.filter(record=>/\/metrics\?/.test(record.path))).toHaveLength(0);
});

it('connects top section links with the same report tabs on repeated selections', async () => {
  const f=fixture(finished());mount(f.client,path);
  await screen.findByRole('heading',{name:'checkout-steady passed'});
  const nav=screen.getByRole('navigation',{name:'Result sections'});
  for(const label of ['Artifacts','Diagnostics','Report','Artifacts','Report']) {
    fireEvent.click(within(nav).getByRole('link',{name:label}));
    await waitFor(()=>expect(screen.getByRole('tab',{name:new RegExp(`^${label}`)})).toHaveAttribute('aria-selected','true'));
  }
  expect(within(nav).getByRole('link',{name:'Artifacts'})).toHaveAttribute('href','#result-artifacts');
  expect(within(nav).getByRole('link',{name:'Diagnostics'})).toHaveAttribute('href','#result-diagnostics');
});
it('opens a deep-linked artifacts section without a preliminary report selection', async () => {
  const f=fixture(finished());mount(f.client,path+'#result-artifacts');
  await screen.findByRole('heading',{name:'checkout-steady passed'});
  expect(await screen.findByRole('tab',{name:/^Artifacts/})).toHaveAttribute('aria-selected','true');
});

it('shows the compact phone chart and measured-average title, with unchanged chart switching and coverage access', async () => {
 vi.stubGlobal('matchMedia',(media:string)=>({media,matches:media==='(max-width: 759px)',
   addEventListener:()=>{},removeEventListener:()=>{}}));
 const current=finished();const f=fixture(current,request=>request.path.endsWith('/metrics/chart-history')?json({...chartData,id:current.id,scope:current.scope,attemptId:current.activeAttemptId}):undefined);mount(f.client,path);
 expect(await screen.findByRole('heading',{level:1,name:/^Averaged/})).toBeVisible();
 expect(await screen.findByRole('heading',{level:2,name:'p95 latency, whole run'})).toBeVisible();
 expect(document.querySelectorAll('#result-whole .live-ticks > span')).toHaveLength(3);
 expect(document.querySelector('#result-whole .live-band')).toBeNull();
 fireEvent.click(screen.getByRole('radio',{name:'Requests'}));
 expect(screen.getByRole('heading',{level:2,name:'Requests, whole run'})).toBeVisible();
 expect(screen.getByRole('img',{name:/Recorded requests per one-second window/})).toBeVisible();
 const coverage=document.querySelector('.result-chart-coverage') as HTMLDetailsElement;
 expect(coverage).not.toHaveAttribute('open');coverage.open=true;fireEvent(coverage,new Event('toggle'));
 expect(within(coverage).getByText(/The axis follows the native measurement marker/)).toBeVisible();
});

it('retries failed result details explicitly without refreshing the run or losing the pending control', async () => {
  let attempts = 0; const pending = deferred<Response>();
  const f = fixture(finished(), request => {
    if (!request.path.endsWith('/result')) return undefined;
    attempts++;
    return attempts === 1 ? json(apiError('storage_unavailable'), 503) : pending.promise;
  });
  mount(f.client, path);
  const retry = await screen.findByRole('button', { name: 'Retry result details' });
  expect(attempts).toBe(1);
  const runReads = f.records.filter(record => record.path.endsWith('/runs/' + runId)).length;
  fireEvent.click(retry);
  await waitFor(() => expect(attempts).toBe(2));
  expect(retry).toBeDisabled();
  pending.resolve(json(resultSnapshot(finished())));
  await waitFor(() => expect(screen.queryByRole('button', { name: 'Retry result details' })).not.toBeInTheDocument());
  expect(f.records.filter(record => record.path.endsWith('/runs/' + runId))).toHaveLength(runReads);
  expect(attempts).toBe(2);
});

it.each([false, true])('keeps native figures and shows only available target detail (target report %s)', async (hasTarget) => {
  const current = finished({ state: 'errored', outcome: 'inconclusive', reason: 'artifact_incomplete' });
  const f = fixture(current, (request) => {
    if (request.path.endsWith('/result')) {
      const summarySha256 = 'a'.repeat(64);
      return json({ ...resultSnapshot(current), result: {
        ...nativeTemplate,
        organizationId: current.scope.organizationId,
        workspaceId: current.scope.workspaceId,
        attemptId: current.activeAttemptId,
        outcome: 'inconclusive',
        completeness: 'partial',
        execution: { ...nativeTemplate.execution, status: 'error', reason: 'artifact_incomplete' },
        artifacts: [{
          artifactId: ids.request, kind: 'native-summary', relativePath: 'beetle-evidence.json', bytes: 1024,
          sha256: summarySha256, sealedAt: nativeTemplate.seal.sealedAt,
        }, ...(hasTarget ? [{
          artifactId: '11111111-2222-4333-8444-555555555555', kind: 'target-runtime',
          relativePath: 'target-runtime.json', bytes: 1024, sha256: 'b'.repeat(64), sealedAt: nativeTemplate.seal.sealedAt,
        }] : [])],
        nativeOverview: {
          summarySha256, durationMs: 600000, requests: 712200, failureRatio: 0.0006, checkPassRatio: 0.9992,
          droppedIterations: 0, p50Ms: 48, p95Ms: 197, p99Ms: 322,
        },
      } });
    }
    if (request.path.endsWith('/metrics/overview') || request.path.endsWith('/metrics/chart-history'))
      return json(apiError('storage_unavailable'), 503);
    return undefined;
  });
  mount(f.client, path);
  await screen.findByText(/^Charts and endpoint detail require a verified metrics archive/);
  const nav = within(screen.getByRole('navigation', { name: 'Result sections' }));
  expect(nav.queryByRole('link', { name: 'Charts' })).not.toBeInTheDocument();
  expect(nav.queryByRole('link', { name: 'Endpoints' })).not.toBeInTheDocument();
  expect(nav.queryAllByRole('link', { name: 'Target runtime' })).toHaveLength(hasTarget ? 1 : 0);
  expect(screen.getByText('One note per run').closest('details')).not.toHaveAttribute('open');
  expect(screen.queryByRole('region', { name: 'The whole run' })).not.toBeInTheDocument();
  expect(screen.getByRole('tab', { name: 'Diagnostics' })).toBeVisible();
  const tiles = await screen.findByLabelText('Verified k6 summary');
  expect(tiles).toHaveTextContent('1,187');
  expect(tiles).toHaveTextContent('197 ms');
  expect(tiles).toHaveTextContent('99.92%');
  expect(tiles).not.toHaveTextContent('histogram');
  expect(screen.getByRole('link', { name: 'Export script' })).toHaveAttribute(
    'href',
    expect.stringContaining(`/revisions/${current.revisionId}/script?run=${current.id}&export=script`),
  );
  expect(screen.getAllByText('Not judged').length).toBeGreaterThan(0);
});

it.each([false, true])('displays recovered charts and prefers a published target report when present (%s)', async (publishedTarget) => {
  const current = finished({ state: 'errored', outcome: 'inconclusive', reason: 'artifact_incomplete' });
  const scope = {
    organizationId: current.scope.organizationId,
    workspaceId: current.scope.workspaceId,
    attemptId: current.activeAttemptId,
    generation: 1,
  };
  const f = fixture(current, (request) => {
    if (publishedTarget && request.path.endsWith('/result')) {
      return json({ ...resultSnapshot(current), result: {
        ...nativeTemplate, ...scope, outcome: 'inconclusive', completeness: 'partial',
        artifacts: [{
          artifactId: ids.request, kind: 'target-runtime', relativePath: 'target-runtime.json',
          bytes: 1024, sha256: 'b'.repeat(64), sealedAt: nativeTemplate.seal.sealedAt,
        }],
      } });
    }
    if (request.path.endsWith('/metrics/chart-history'))
      return json({
        id: current.id,
        scope: current.scope,
        attemptId: current.activeAttemptId,
        source: null,
        windows: 0,
        sampled: false,
        points: [],
        observedPeakRequestsPerSecond: null,
        knownRequestWindows: 0,
        meanVus: null,
        knownVusWindows: 0,
        reason: 'not_recorded',
      });
    if (request.path.endsWith('/metrics/overview'))
      return json({ id: current.id, scope: current.scope, attemptId: current.activeAttemptId,
        availability: 'not_recorded', source: null, testDurationMs: null, requestCount: null,
        requestsPerSecond: null, failure: null, latency: null, checks: null, droppedIterations: null, endpoints: [],
        omittedEndpoints: 0 });
    if (request.path.endsWith('/metrics/stopped-history'))
      return json({
        ...recoveredData,
        scope,
        prefix: { ...recoveredData.prefix, scope, target: { ...recoveredData.prefix.target, scope } },
        targetSamples: recoveredData.targetSamples.map((sample) => ({
          ...sample,
          observedAt: '1970-01-01T00:00:01.000Z',
        })),
      });
    return undefined;
  });
  mount(f.client, path, {
    readOnly: true,
    restoredBackup: { backupId: ids.request, createdAt: '2026-11-12T02:00:00.000Z' },
  });
  expect(await screen.findByRole('heading', { name: 'Recovered before the stop' })).toBeVisible();
  const retained = screen.getByText(/1 of 1 recorded windows shown/);
  expect(retained).toBeVisible();
  expect(retained.querySelector('time')).toHaveAttribute('datetime', '1970-01-01T00:00:01.000Z');
  expect(screen.queryByRole('table', { name: 'Endpoints in the last retained window' })).toBeNull();
  expect(screen.getByRole('img', { name: /Recovered p95 latency/ })).toBeVisible();
  fireEvent.click(within(screen.getByRole('region', { name: 'Recovered charts' })).getByRole('radio', { name: 'Requests' }));
  expect(screen.getByRole('img', { name: /Recovered requests a second/ })).toBeVisible();
  const recoveredTarget = screen.queryByRole('img', { name: /Heap and RSS:.*1,024/ });
  if (publishedTarget) {
    expect(recoveredTarget).not.toBeInTheDocument();
    expect(document.querySelector('#result-target')).toHaveAttribute('aria-labelledby', 'result-target-title');
  } else expect(recoveredTarget).toBeVisible();
  expect(document.querySelectorAll('#result-target')).toHaveLength(1);
  expect(screen.queryByRole('button', { name: 'Run again' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Check for the result again' })).not.toBeInTheDocument();
  expect(f.records.filter((record) => record.path.endsWith('/metrics/stopped-history'))).toHaveLength(1);
});

it('keeps a confirmed early-cancel result free of controls for unavailable measurements', async () => {
  const current = finished({ state: 'cancelled', outcome: 'inconclusive', reason: 'cancelled', cancellationRequested: true });
  const identity = { id: current.id, scope: current.scope, attemptId: current.activeAttemptId };
  const f = fixture(current, (request) => {
    if (request.path.endsWith('/metrics/chart-history'))
      return json({ ...identity, source: null, windows: 0, sampled: false, points: [], observedPeakRequestsPerSecond: null,
        knownRequestWindows: 0, meanVus: null, knownVusWindows: 0, reason: 'not_recorded' });
    if (request.path.endsWith('/metrics/overview'))
      return json({ ...identity, availability: 'not_recorded', source: null, testDurationMs: null, requestCount: null,
        requestsPerSecond: null, failure: null, latency: null, checks: null, droppedIterations: null, endpoints: [],
        omittedEndpoints: 0 });
    if (request.path.includes('/runs?'))
      return json({ scope: current.scope, items: [current], nextCursor: null,
        summaries: [{ ...pendingRunHistorySummary(current), availability: 'not_recorded' }] });
    if (request.path.endsWith('/metrics/stopped-history')) return json(apiError('not_found'), 404);
    return undefined;
  });
  mount(f.client, path);
  expect(await screen.findByText('No whole-run figures were recorded.')).toBeVisible();
  expect(screen.getByText('No chart history was recorded.')).toBeVisible();
  expect(screen.getByText('Endpoint measurements are unavailable.')).toBeVisible();
  expect(screen.queryByRole('searchbox', { name: 'Filter endpoints' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Retry recorded charts' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Check measurements' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Compare recorded phases' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Check for the result again' })).not.toBeInTheDocument();
});

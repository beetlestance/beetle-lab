import { pendingRunHistorySummary } from '@beetle/contracts/api';
import { expect, it } from 'vitest';
import { createApiClient, validateApi } from '../../../src/api/index.js';
import type { Run } from '../../../src/api/index.js';
import { baseUrl, load, otherId, params, reply } from './helpers.js';

it('rejects enqueue fields that could select arbitrary runtime inputs before fetch', async () => {
  const body = await load('create-run', 'CreateRunRequest');
  const fetcher = reply({}); const client = createApiClient({ baseUrl, fetch: fetcher });
  for (const extra of [{ config: {} }, { imageDigest: `sha256:${'f'.repeat(64)}` },
    { secretValues: { token: 'synthetic' } }, { mount: '/tmp/synthetic' }]) {
    expect(await client.createRun({ params, body: { ...body, ...extra } }))
      .toEqual({ ok: false, error: { kind: 'request' } });
  }
  expect(fetcher).not.toHaveBeenCalled();
});

it('binds accepted enqueue to the exact revision/profile/budget/policy and original queued snapshot', async () => {
  const body = await load('create-run', 'CreateRunRequest'); const run = await load('run', 'Run');
  expect(await createApiClient({ baseUrl, fetch: reply(run, 202) }).createRun({ params, body }))
    .toEqual({ ok: true, value: run });
  const mismatches: Run[] = [{ ...run, revisionId: otherId },
    { ...run, engine: { ...run.engine, profileId: 'different-profile' } },
    { ...run, budget: { ...run.budget, cpuMillis: run.budget.cpuMillis + 1 } },
    { ...run, executionPolicy: { ...run.executionPolicy, preferIdle: true } },
    { ...run, executionPolicy: { ...run.executionPolicy, mode: 'isolated' } },
    { ...run, version: 2 }, { ...run, state: 'active' }];
  for (const value of mismatches) {
    expect(validateApi('Run', value).ok).toBe(true);
    expect(await createApiClient({ baseUrl, fetch: reply(value, 202) }).createRun({ params, body }))
      .toEqual({ ok: false, error: { kind: 'response' } });
  }
});

it('rejects wrong detail IDs and cross-workspace page items', async () => {
  const run = await load('run', 'Run');
  expect(await createApiClient({ baseUrl, fetch: reply({ ...run, id: otherId }) }).getRun({
    params: { ...params, runId: run.id },
  })).toEqual({ ok: false, error: { kind: 'response' } });
  const page = await load('run-page', 'RunPage'); page.items[0]!.scope.workspaceId = otherId;
  expect(await createApiClient({ baseUrl, fetch: reply(page) }).listRuns({ params, query: { limit: 10 } }))
    .toEqual({ ok: false, error: { kind: 'response' } });
});

it('does not accept a queued pass or an execution error reported as a test pass', async () => {
  const run = await load('run', 'Run');
  for (const value of [{ ...run, outcome: 'passed' }, { ...run, state: 'errored', outcome: 'passed' },
    { ...run, state: 'finished', outcome: 'passed', validationStatus: 'pending' }]) {
    expect(validateApi('Run', value).ok).toBe(true);
    expect(await createApiClient({ baseUrl, fetch: reply(value) }).getRun({ params: { ...params, runId: run.id } }))
      .toEqual({ ok: false, error: { kind: 'response' } });
  }
});

it('bounds run pages and request policy without coercion or default insertion', async () => {
  const page = await load('run-page', 'RunPage');
  expect(validateApi('RunPage', { ...page, items: Array.from({ length: 101 }, () => page.items[0]) }).ok).toBe(false);
  const body = await load('create-run', 'CreateRunRequest');
  for (const executionPolicy of [{ mode: 'parallel' }, { mode: 'auto', preferIdle: false },
    { mode: 'parallel', preferIdle: 'false' }]) {
    const original = structuredClone(executionPolicy);
    expect(validateApi('CreateRunRequest', { ...body, executionPolicy }).ok).toBe(false);
    expect(executionPolicy).toEqual(original);
  }
});

it('preserves a completed discovery run with an inconclusive outcome in detail and history', async () => {
  const queued = await load('run', 'Run');
  // Discovery can exhaust its range without reaching the abort rule; this is not an execution error.
  const run: Run = { ...queued, state: 'finished', outcome: 'inconclusive', validationStatus: 'passed', version: 4 };
  expect(await createApiClient({ baseUrl, fetch: reply(run) }).getRun({ params: { ...params, runId: run.id } }))
    .toEqual({ ok: true, value: run });
  const page = { scope: run.scope, items: [run], summaries: [pendingRunHistorySummary(run)], nextCursor: null };
  expect(await createApiClient({ baseUrl, fetch: reply(page) }).listRuns({ params, query: { limit: 10 } }))
    .toEqual({ ok: true, value: page });
});

it('binds an initial note to the creation receipt while preserving omitted-note legacy receipts', async () => {
  const body={...await load('create-run','CreateRunRequest'),note:' After connection-pool fix '};
  const run={...await load('run','Run'),note:'After connection-pool fix',noteVersion:1};
  expect((await createApiClient({baseUrl,fetch:reply(run,202)}).createRun({params,body})).ok).toBe(true);
  for(const value of [{...run,note:null},{...run,note:'Wrong'},{...run,noteVersion:2}])
    expect((await createApiClient({baseUrl,fetch:reply(value,202)}).createRun({params,body})).ok).toBe(false);
});

it('accepts optional scoped workspace names and rejects malformed names or foreign page scope',async()=>{
 const page=await load('run-page','RunPage');const read=(body:unknown)=>createApiClient({baseUrl,fetch:reply(body)}).listRuns({params,query:{limit:10}});
 expect((await read({...page,workspaceName:'Current workspace'})).ok).toBe(true);expect((await read(page)).ok).toBe(true);
 expect((await read({...page,workspaceName:'x'.repeat(129)})).ok).toBe(false);
 expect((await read({...page,scope:{...page.scope,workspaceId:otherId},workspaceName:'Foreign workspace'})).ok).toBe(false);
});

it('sends count enrichment explicitly and rejects contradictory snapshot counts/ranges',async()=>{
 const page=await load('run-page','RunPage');
 const counts={all:page.items.length,running:page.items.filter(r=>r.state==='active').length,passed:page.items.filter(r=>r.outcome==='passed').length,failed:page.items.filter(r=>r.outcome==='failed').length,cancelled:page.items.filter(r=>r.state==='cancelled').length,pinned:0,matched:page.items.length,before:0};
 const fetcher=reply({...page,counts});const client=createApiClient({baseUrl,fetch:fetcher});
 expect((await client.listRuns({params,query:{limit:10,includeCounts:true}})).ok).toBe(true);
 expect(String(fetcher.mock.calls[0]![0])).toContain('includeCounts=true');
 for(const changed of [{...counts,before:1},{...counts,matched:0},{...counts,all:0},{...counts,pinned:257}]){
  expect((await createApiClient({baseUrl,fetch:reply({...page,counts:changed})}).listRuns({params,query:{limit:10,includeCounts:true}})).ok).toBe(false);
 }
 expect((await createApiClient({baseUrl,fetch:reply(page)}).listRuns({params,query:{limit:10,includeCounts:true}})).ok).toBe(true);
});

it('binds matched counts to a known lifecycle chip and accepts explicit optional count unavailability',async()=>{
 const page=await load('run-page','RunPage');const active={...page.items[0]!,state:'active' as const,outcome:'pending' as const};
 const counts={all:100,running:1,passed:0,failed:0,cancelled:0,pinned:0,matched:100,before:0};
 const {encodeRunListCursor}=await import('../../../src/api/index.js');
 const cursor=encodeRunListCursor({scope:page.scope,query:{limit:1,state:'active',order:'newest'},requestedAt:active.requestedAt,id:active.id});
 const invalid={...page,items:[active],summaries:[pendingRunHistorySummary(active)],contexts:undefined,counts,nextCursor:cursor};
 expect((await createApiClient({baseUrl,fetch:reply(invalid)}).listRuns({params,query:{limit:1,state:'active',includeCounts:true}})).ok).toBe(false);
 const empty={...page,items:[],summaries:[],contexts:[],countsUnavailable:'search_too_broad',nextCursor:null};
 expect((await createApiClient({baseUrl,fetch:reply(empty)}).listRuns({params,query:{limit:10,pinned:true,includeCounts:true}})).ok).toBe(true);
 expect((await createApiClient({baseUrl,fetch:reply({...empty,counts})}).listRuns({params,query:{limit:10,pinned:true,includeCounts:true}})).ok).toBe(false);
});

// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, expect, it } from 'vitest';
import { act, cleanup, renderHook, screen, waitFor, within } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { ApiContext } from '../../app/api.js';
import { createQueryClient } from '../../app/queries.js';
import { routes } from '../../app/routes.js';
import { historyPage, run, mount, testClient, ids, json, scope } from './test-fixtures.js';
import { suitesPage } from './history-fixtures.js';
import { useSuiteNames } from './HistorySuites.js';
afterEach(cleanup);
it('uses same-page names and revision ordinals beyond the suite index without row reads', async () => {
  const current=run();const page=historyPage([current]);
  page.contexts=[{runId:current.id,suiteId:current.suiteId,revisionId:current.revisionId,suiteName:'Archived suite outside index',revisionOrdinal:73}];
  const f=testClient(request=>request.path.includes('/suites?')?json({...suitesPage(),items:[],summaries:[]}):json(page));
  mount(f.client,routes.runs(ids.a,ids.workspace));const table=await screen.findByRole('table');
  expect(within(table).getByText('Archived suite outside index')).toBeVisible();expect(within(table).getByText(', rev 73')).toBeVisible();
  expect(f.records.filter(record=>record.path.includes('/runs?'))).toHaveLength(1);
  expect(f.records.some(record=>record.path.includes('/revisions/')||/\/suites\/[^?]+$/.test(record.path))).toBe(false);
});
it('does not attach another run’s context to history',async()=>{
  const current=run();const page=historyPage([current]);page.contexts=[{runId:ids.request,suiteId:current.suiteId,revisionId:current.revisionId,suiteName:'Wrong row',revisionOrdinal:73}];
  const f=testClient(request=>request.path.includes('/suites?')?json(suitesPage()):json(page));mount(f.client,routes.runs(ids.a,ids.workspace));
  await screen.findByRole('alert');expect(screen.queryByRole('table')).not.toBeInTheDocument();expect(screen.queryByText('Wrong row')).not.toBeInTheDocument();
});
it('withdraws suite-index names after a failed refresh',async()=>{
  let failed=false;const f=testClient(()=>failed?new Response(null,{status:503}):json(suitesPage()));const client=createQueryClient();
  const view=renderHook(()=>useSuiteNames(scope),{wrapper:({children})=><QueryClientProvider client={client}><ApiContext.Provider value={f.client}>{children}</ApiContext.Provider></QueryClientProvider>});
  await act(async()=>{await client.refetchQueries()});await waitFor(()=>expect(view.result.current.name(run().suiteId)).toBe('checkout-steady'));
  failed=true;await act(async()=>{await client.refetchQueries()});await waitFor(()=>expect(view.result.current.name(run().suiteId)).toBeUndefined());expect(view.result.current.suites).toEqual([]);
  view.unmount();client.clear();
});

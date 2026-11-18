// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { ApiContext } from '../../../app/api.js';
import { createQueryClient, queryKeys } from '../../../app/queries.js';
import { json, testClient } from '../../../app/test-fixtures.js';
import { liveRun, revision } from './fixtures.js';
import { useRevision } from './data.js';
const clients:ReturnType<typeof createQueryClient>[]=[];
afterEach(()=>{cleanup();clients.splice(0).forEach(client=>client.clear());});
function Harness(){const query=useRevision(liveRun());return query.isError?<p role="alert">Revision refused</p>:<p>{query.data?.suiteId??'Loading'}</p>;}
it.each(['suite','digest'] as const)('rejects a cached revision with another %s before rendering or fetching',async field=>{
 const current=liveRun();const value=revision();
 if(field==='suite')value.suiteId='99999999-9999-4999-8999-999999999999';else value.digest='b'.repeat(64);
 const client=createQueryClient();clients.push(client);client.setQueryData(queryKeys.suiteRevision(current.scope.organizationId,current.scope.workspaceId,current.revisionId),value);
 const api=testClient(()=>{throw Error('Cached immutable read must not fetch');});
 render(<ApiContext.Provider value={api.client}><QueryClientProvider client={client}><Harness/></QueryClientProvider></ApiContext.Provider>);
 expect(await screen.findByRole('alert')).toHaveTextContent('Revision refused');expect(api.records).toHaveLength(0);
});
it('rejects a fresh scoped reply whose digest differs from the accepted run',async()=>{
 const client=createQueryClient();clients.push(client);const api=testClient(()=>json({...revision(),digest:'b'.repeat(64)}));
 render(<ApiContext.Provider value={api.client}><QueryClientProvider client={client}><Harness/></QueryClientProvider></ApiContext.Provider>);
 expect(await screen.findByRole('alert')).toHaveTextContent('Revision refused');expect(api.records).toHaveLength(1);
});

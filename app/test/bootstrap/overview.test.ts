import {expect,it} from 'vitest';
import {randomUUID} from 'node:crypto';
import {runFixture,client,savedSuite,value} from './run-fixture.js';
import {settingsFixture,observation} from '../storage/fixture.js';
const fixture=runFixture();
function fundedRunMetadata(){
 const settings=settingsFixture();settings.chain.installation.values.pool.storageBytes=1_000_000;settings.runtime.pool.storageBytes=1_000_000;
 return {installation:settings.chain.installation,runtime:observation(settings.runtime)};
}
it('serves the real scoped dashboard through application HTTP, generated client and durable worker across reopen',async()=>{
 const first=await fixture.open(undefined,fundedRunMetadata());const initial=await client(first.app);const saved=await savedSuite(initial.api);
 const empty=value(await initial.api.getWorkspaceOverview({params:saved.params}));expect(empty.counts).toMatchObject({folders:1,suites:1,runs:0,queued:0});
 const run=value(await initial.api.createRun({params:saved.params,body:{scope:saved.scope,requestId:randomUUID(),revisionId:saved.pinned.id,engineProfile:'standard',
  budget:settingsFixture().chain.installation.values.runDefaults.budget,executionPolicy:{mode:'parallel',preferIdle:false}}}));
 const overview=value(await initial.api.getWorkspaceOverview({params:saved.params}));expect(overview.counts).toMatchObject({runs:1,queued:1,active:0,submitted24h:1});
 expect(overview.recent.map(row=>row.id)).toEqual([run.id]);expect(overview.activity.reduce((n,row)=>n+row.count,0)).toBe(1);
 await fixture.close(first.app);const second=await fixture.open(first.path,{runtime:null,runs:{profiles:[],pendingLimit:1}});const restarted=await client(second.app);
 const durable=value(await restarted.api.getWorkspaceOverview({params:saved.params}));expect(durable.counts).toEqual(overview.counts);expect(durable.recent).toEqual(overview.recent);
 expect(value(await restarted.api.listRuns({params:saved.params,query:{limit:100}})).items).toHaveLength(1);
});

it('serves organisation rollups through authenticated TCP and the generated client across worker reopen',async()=>{
 const first=await fixture.open(undefined,fundedRunMetadata(),true);const initial=await client(first.app,false,first.origin);const saved=await savedSuite(initial.api);
 const params={organizationId:saved.params.organizationId};const empty=value(await initial.api.getOrganizationOverview({params}));
 expect(empty.workspaces).toBe(1);expect(empty.counts).toMatchObject({suites:1,runs:0});
 const run=value(await initial.api.createRun({params:saved.params,body:{scope:saved.scope,requestId:randomUUID(),revisionId:saved.pinned.id,engineProfile:'standard',budget:settingsFixture().chain.installation.values.runDefaults.budget,executionPolicy:{mode:'parallel',preferIdle:false}}}));
 const snapshot=value(await initial.api.getOrganizationOverview({params}));expect(snapshot.counts.runs).toBe(1);
 expect(snapshot.recent[0]).toMatchObject({id:run.id,workspaceId:saved.params.workspaceId});
 await fixture.close(first.app);const second=await fixture.open(first.path,{runtime:null,runs:{profiles:[],pendingLimit:1}},true);const reopened=await client(second.app,false,second.origin);
 expect(value(await reopened.api.getOrganizationOverview({params})).counts).toEqual(snapshot.counts);
});

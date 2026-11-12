import {expect,it} from 'vitest';
import {randomUUID} from 'node:crypto';
import {runFixture,client,savedSuite,value} from './run-fixture.js';
import {settingsFixture} from '../storage/fixture.js';
const fixture=runFixture();
it('serves the real scoped dashboard through application HTTP, generated client and durable worker across reopen',async()=>{
 const first=await fixture.open();const initial=await client(first.app);const saved=await savedSuite(initial.api);
 const empty=value(await initial.api.getWorkspaceOverview({params:saved.params}));expect(empty.counts).toMatchObject({folders:1,suites:1,runs:0,queued:0});
 const run=value(await initial.api.createRun({params:saved.params,body:{scope:saved.scope,requestId:randomUUID(),revisionId:saved.pinned.id,engineProfile:'standard',
  budget:settingsFixture().chain.installation.values.runDefaults.budget,executionPolicy:{mode:'parallel',preferIdle:false}}}));
 const overview=value(await initial.api.getWorkspaceOverview({params:saved.params}));expect(overview.counts).toMatchObject({runs:1,queued:1,active:0,submitted24h:1});
 expect(overview.recent.map(row=>row.id)).toEqual([run.id]);expect(overview.activity.reduce((n,row)=>n+row.count,0)).toBe(1);
 await fixture.close(first.app);const second=await fixture.open(first.path,{runtime:null,runs:{profiles:[],pendingLimit:1}});const restarted=await client(second.app);
 const durable=value(await restarted.api.getWorkspaceOverview({params:saved.params}));expect(durable.counts).toEqual(overview.counts);expect(durable.recent).toEqual(overview.recent);
 expect(value(await restarted.api.listRuns({params:saved.params,query:{limit:100}})).items).toHaveLength(1);
});

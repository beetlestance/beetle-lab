import {expect,it} from 'vitest';
import {randomUUID} from 'node:crypto';
import {runFixture,client,savedSuite,value} from './run-fixture.js';
import {settingsFixture,observation} from '../storage/fixture.js';
const fixture=runFixture();
it('serves exact-suite keyset history through authenticated HTTP and worker reopen',async()=>{
 const settings=settingsFixture();settings.chain.installation.values.pool.storageBytes=1_000_000;settings.runtime.pool.storageBytes=1_000_000;
 const first=await fixture.open(undefined,{installation:settings.chain.installation,runtime:observation(settings.runtime)},true);
 const connection=await client(first.app,false,first.origin);const saved=await savedSuite(connection.api);
 const peer=value(await connection.api.createSuite({params:saved.params,body:{scope:saved.scope,requestId:randomUUID(),name:'Peer'}}));
 const peerRevision=value(await connection.api.createSuiteRevision({params:{...saved.params,suiteId:peer.id},body:{scope:saved.scope,requestId:randomUUID(),expectedVersion:peer.version,engineId:'k6',configVersion:1,config:saved.pinned.config}}));
 const ids:string[]=[];
 for(const revisionId of [saved.pinned.id,peerRevision.id,saved.pinned.id]){
  const run=value(await connection.api.createRun({params:saved.params,body:{scope:saved.scope,requestId:randomUUID(),revisionId,engineProfile:'standard',budget:settings.chain.installation.values.runDefaults.budget,executionPolicy:{mode:'parallel',preferIdle:false}}}));
  if(revisionId===saved.pinned.id)ids.push(run.id);
 }
 const query={limit:1,suiteId:saved.pinned.suiteId};const page=value(await connection.api.listRuns({params:saved.params,query}));
 expect(page.items).toHaveLength(1);expect(page.items[0]!.suiteId).toBe(query.suiteId);expect(page.nextCursor).not.toBeNull();
 const next=value(await connection.api.listRuns({params:saved.params,query:{...query,cursor:page.nextCursor!}}));
 expect(new Set([...page.items,...next.items].map(row=>row.id))).toEqual(new Set(ids));
 expect(value(await connection.api.listRuns({params:saved.params,query:{...query,name:'Peer'}})).items).toEqual([]);
 await fixture.close(first.app);const second=await fixture.open(first.path,{runtime:null,runs:{profiles:[],pendingLimit:1}},true);const reopened=await client(second.app,false,second.origin);
 expect(value(await reopened.api.listRuns({params:saved.params,query}))).toEqual(page);
});

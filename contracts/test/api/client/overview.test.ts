import {expect,it} from 'vitest';
import {createApiClient,workspaceOverviewMatches} from '../../../src/api/index.js';
import {load,params,otherId,reply,baseUrl} from './helpers.js';
it('accepts an actual bounded snapshot and rejects foreign or incoherent overview responses',async()=>{
 const value=await load('workspace-overview','WorkspaceOverview');
 expect(workspaceOverviewMatches(value,params)).toBe(true);
 const invoke=(data:unknown)=>createApiClient({baseUrl,fetch:reply(data)}).getWorkspaceOverview({params});
 expect((await invoke(value)).ok).toBe(true);
 for(const bad of [{...value,scope:{...value.scope,workspaceId:otherId}},{...value,counts:{...value.counts,submitted24h:1}},{...value,activeHasMore:true},{...value,activity:value.activity.slice(1)},
  {...value,activity:value.activity.map((bucket,i)=>i?bucket:{...bucket,to:value.generatedAt})}])expect((await invoke(bad)).ok).toBe(false);
});
it('rejects duplicate or out-of-order summaries and invalid state/outcome combinations',async()=>{
 const value=await load('workspace-overview','WorkspaceOverview');
 const row={id:otherId,suiteId:otherId,revisionId:otherId,requestedAt:value.windowStart,state:'active' as const,outcome:'pending' as const};
 const full={...value,counts:{...value.counts,runs:1,active:1,submitted24h:1},activity:value.activity.map((bucket,i)=>i?bucket:{...bucket,count:1,outcomes:{passed:0,failed:0,inProgress:1,other:0}}),recent:[row],active:[row]};
 expect(workspaceOverviewMatches(full,params)).toBe(true);
 expect(workspaceOverviewMatches({...full,counts:{...full.counts,submitted24h:0},activity:value.activity},params)).toBe(false);
 expect(workspaceOverviewMatches({...full,counts:{...full.counts,active:0,finished:1},active:[]},params)).toBe(false);
 expect(workspaceOverviewMatches({...full,recent:[{...row,state:'finished',outcome:'passed'}]},params)).toBe(false);
 expect(workspaceOverviewMatches({...full,active:[{...row,revisionId:params.workspaceId}]},params)).toBe(false);
 expect(workspaceOverviewMatches({...full,active:[{...row,outcome:'failed'}]},params)).toBe(false);
 expect(workspaceOverviewMatches({...full,counts:{...full.counts,runs:2,active:2},recent:[row,row],active:[row,row]},params)).toBe(false);
});

it('rejects missing or contradictory hourly outcome accounting at the generated client boundary',async()=>{
 const value=await load('workspace-overview','WorkspaceOverview');
 const invoke=(data:unknown)=>createApiClient({baseUrl,fetch:reply(data)}).getWorkspaceOverview({params});
 const bad={...value,activity:value.activity.map((bucket,i)=>i?bucket:{...bucket,outcomes:{passed:1,failed:0,inProgress:0,other:0}})};
 expect((await invoke(bad)).ok).toBe(false);
 const missing=JSON.parse(JSON.stringify(value));delete missing.activity[0].outcomes;
 expect((await invoke(missing)).ok).toBe(false);
});

it('binds hourly categories to scalar failures and known recent headers',async()=>{
 const value=await load('workspace-overview','WorkspaceOverview');
 const row={id:otherId,suiteId:otherId,revisionId:otherId,requestedAt:value.windowStart,state:'finished' as const,outcome:'failed' as const};
 const correct={...value,counts:{...value.counts,runs:1,finished:1,submitted24h:1,failed24h:1},recent:[row],
   activity:value.activity.map((bucket,i)=>i?bucket:{...bucket,count:1,outcomes:{passed:0,failed:1,inProgress:0,other:0}})};
 expect(workspaceOverviewMatches(correct,params)).toBe(true);
 expect(workspaceOverviewMatches({...correct,counts:{...correct.counts,failed24h:0}},params)).toBe(false);
 const swapped={...correct,activity:correct.activity.map((bucket,i)=>i?bucket:{...bucket,outcomes:{passed:1,failed:0,inProgress:0,other:0}})};
 expect(workspaceOverviewMatches(swapped,params)).toBe(false);
 const two={...correct,counts:{...correct.counts,runs:2,finished:2,submitted24h:2},
   recent:[{...row,id:params.workspaceId,requestedAt:value.activity[1]!.from},{...row,outcome:'passed' as const}],
   activity:correct.activity.map((bucket,i)=>i>1?bucket:{...bucket,count:1,outcomes:{passed:i===0?1:0,failed:i===1?1:0,inProgress:0,other:0}})};
 expect(workspaceOverviewMatches(two,params)).toBe(true);
 expect(workspaceOverviewMatches({...two,activity:two.activity.map((bucket,i)=>i>1?bucket:{...bucket,outcomes:{passed:i===1?1:0,failed:i===0?1:0,inProgress:0,other:0}})},params)).toBe(false);
});

it('bounds hourly categories by whole-scope states when recent runs do not witness the window',async()=>{
 const value=await load('workspace-overview','WorkspaceOverview');
 const recent=Array.from({length:8},(_,index)=>({id:`00000000-0000-4000-8000-${String(100+index).padStart(12,'0')}`,suiteId:otherId,revisionId:otherId,
   requestedAt:new Date(Date.parse(value.generatedAt)+(8-index)*1000).toISOString(),state:'finished' as const,outcome:'passed' as const}));
 const full={...value,counts:{...value.counts,runs:9,finished:9,submitted24h:1},recent,
   activity:value.activity.map((bucket,index)=>index?bucket:{...bucket,count:1,outcomes:{passed:1,failed:0,inProgress:0,other:0}})};
 expect(workspaceOverviewMatches(full,params)).toBe(true);
 expect(workspaceOverviewMatches({...full,activity:full.activity.map((bucket,index)=>index?bucket:{...bucket,outcomes:{passed:0,failed:0,inProgress:1,other:0}})},params)).toBe(false);
});

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
 const full={...value,counts:{...value.counts,runs:1,active:1,submitted24h:1},activity:value.activity.map((bucket,i)=>i?bucket:{...bucket,count:1}),recent:[row],active:[row]};
 expect(workspaceOverviewMatches(full,params)).toBe(true);
 expect(workspaceOverviewMatches({...full,counts:{...full.counts,submitted24h:0},activity:value.activity},params)).toBe(false);
 expect(workspaceOverviewMatches({...full,counts:{...full.counts,active:0,finished:1},active:[]},params)).toBe(false);
 expect(workspaceOverviewMatches({...full,recent:[{...row,state:'finished',outcome:'passed'}]},params)).toBe(false);
 expect(workspaceOverviewMatches({...full,active:[{...row,revisionId:params.workspaceId}]},params)).toBe(false);
 expect(workspaceOverviewMatches({...full,active:[{...row,outcome:'failed'}]},params)).toBe(false);
 expect(workspaceOverviewMatches({...full,counts:{...full.counts,runs:2,active:2},recent:[row,row],active:[row,row]},params)).toBe(false);
});

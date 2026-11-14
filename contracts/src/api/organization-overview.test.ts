import {expect,it} from 'vitest';
import {validateApi} from './validate.js';
import {createApiClient} from './client/index.js';
import {organizationOverviewMatches} from './overview.js';
import type {OrganizationOverview} from './generated/types.js';
import fixture from '../../fixtures/api/valid/organization-overview.json';
it('binds organization snapshot arithmetic, scope and cross-list workspace identity',()=>{
 const value=structuredClone(fixture) as OrganizationOverview;expect(validateApi('OrganizationOverview',value).ok).toBe(true);
 expect(organizationOverviewMatches(value,value.scope)).toBe(true);
 expect(organizationOverviewMatches(value,{organizationId:'00000000-0000-4000-8000-000000000099'})).toBe(false);
 const bad=structuredClone(value);bad.workspaces=bad.counts.folders+1;expect(organizationOverviewMatches(bad,bad.scope)).toBe(false);
 const counts=structuredClone(value);counts.counts.runs++;expect(organizationOverviewMatches(counts,counts.scope)).toBe(false);
});
it('rejects foreign snapshots through the actual generated operation client',async()=>{
 const value=structuredClone(fixture) as OrganizationOverview;
 const client=createApiClient({baseUrl:'http://synthetic.invalid',fetch:async()=>new Response(JSON.stringify(value),{headers:{'content-type':'application/json'}})});
 const result=await client.getOrganizationOverview({params:{organizationId:'00000000-0000-4000-8000-000000000099'}});
 expect(result.ok).toBe(false);
});

it('refuses nonzero metadata in an empty organisation and too many distinct workspace headers',()=>{
 const empty=structuredClone(fixture) as OrganizationOverview;empty.workspaces=0;empty.counts.folders=1;
 expect(organizationOverviewMatches(empty,empty.scope)).toBe(false);
 const many=structuredClone(fixture) as OrganizationOverview;many.workspaces=1;many.counts={...many.counts,runs:2,queued:2,submitted24h:2};many.activity[23]!.count=2;
 const first={id:'00000000-0000-4000-8000-000000000091',workspaceId:'00000000-0000-4000-8000-000000000081',suiteId:'00000000-0000-4000-8000-000000000071',revisionId:'00000000-0000-4000-8000-000000000061',requestedAt:many.activity[23]!.from,state:'queued' as const,outcome:'pending' as const};
 many.recent=[first,{...first,id:'00000000-0000-4000-8000-000000000090',workspaceId:'00000000-0000-4000-8000-000000000080'}];
 expect(validateApi('OrganizationOverview',many).ok).toBe(true);expect(organizationOverviewMatches(many,many.scope)).toBe(false);
});

import {encodeJson} from '@beetle/contracts';
import {validateApi,workspaceOverviewMatches} from '@beetle/contracts/api';
import type {WorkspaceOverview} from '@beetle/contracts/api';
import type {OverviewQuery,OverviewReader} from '../../ports/overview.js';
import {requireRule} from '../../domain/namespaces/index.js';
export function checkedOverviewQuery(input:OverviewQuery):OverviewQuery{
 const query=JSON.parse(encodeJson(input,2048)) as OverviewQuery;
 requireRule(Object.keys(query).length===2&&validateApi('WorkspaceScope',query.scope).ok&&validateApi('RunTimestamp',query.now).ok);
 const now=Date.parse(query.now);requireRule(Number.isFinite(now)&&now>=86400000&&new Date(now).toISOString()===query.now);
 return query;
}
export function checkedOverview(value:unknown,query:OverviewQuery):WorkspaceOverview{
 const copy=JSON.parse(encodeJson(value,32768)) as unknown;const result=validateApi('WorkspaceOverview',copy);
 requireRule(result.ok);if(!result.ok)throw Error('Invalid overview');
 requireRule(result.value.generatedAt===query.now&&workspaceOverviewMatches(result.value,query.scope),'not_found');return result.value;
}
export async function getOverview(input:OverviewQuery,reader:OverviewReader):Promise<WorkspaceOverview>{
 const query=checkedOverviewQuery(input);return checkedOverview(await reader.read(query),query);
}

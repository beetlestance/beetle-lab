import {encodeJson} from '@beetle/contracts';
import {validateApi,organizationOverviewMatches} from '@beetle/contracts/api';
import type {OrganizationOverview} from '@beetle/contracts/api';
import type {OrganizationOverviewQuery,OrganizationOverviewReader} from '../../ports/overview.js';
import {requireRule,immutableSnapshot} from '../../domain/namespaces/index.js';
export function checkedOrganizationOverviewQuery(input:OrganizationOverviewQuery):OrganizationOverviewQuery{
 const query=JSON.parse(encodeJson(input,2048)) as OrganizationOverviewQuery;
 requireRule(Object.keys(query).length===2&&validateApi('OrganizationScope',query.scope).ok&&validateApi('RunTimestamp',query.now).ok);
 const now=Date.parse(query.now);requireRule(Number.isFinite(now)&&now>=86400000&&new Date(now).toISOString()===query.now);return immutableSnapshot(query);
}
export function checkedOrganizationOverview(input:unknown,query:OrganizationOverviewQuery):OrganizationOverview{
 const checked=validateApi('OrganizationOverview',JSON.parse(encodeJson(input,32768)) as unknown);
 requireRule(checked.ok);requireRule(organizationOverviewMatches(checked.value,query.scope)&&checked.value.generatedAt===query.now,'not_found');return checked.value;
}
export async function getOrganizationOverview(input:OrganizationOverviewQuery,reader:OrganizationOverviewReader):Promise<OrganizationOverview>{
 const query=checkedOrganizationOverviewQuery(input);return checkedOrganizationOverview(await reader.read(query),query);
}

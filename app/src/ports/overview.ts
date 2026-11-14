import type {WorkspaceOverview,WorkspaceScope,OrganizationOverview,OrganizationScope} from '@beetle/contracts/api';
/** Fixed 24h read snapshot; trusted server clock, bounded summaries and scalar counts. */
export interface OverviewQuery {readonly scope:WorkspaceScope;readonly now:string}
export interface OverviewReader {read(query:OverviewQuery):Promise<WorkspaceOverview>}

export interface OrganizationOverviewQuery {readonly scope:OrganizationScope;readonly now:string}
export interface OrganizationOverviewReader {read(query:OrganizationOverviewQuery):Promise<OrganizationOverview>}

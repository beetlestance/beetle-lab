import type {WorkspaceOverview,WorkspaceScope} from '@beetle/contracts/api';
/** Fixed 24h read snapshot; trusted server clock, bounded summaries and scalar counts. */
export interface OverviewQuery {readonly scope:WorkspaceScope;readonly now:string}
export interface OverviewReader {read(query:OverviewQuery):Promise<WorkspaceOverview>}

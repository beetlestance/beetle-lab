import type { WorkspaceScope } from '@beetle/contracts/api';
import { queryKeys } from '../../app/queries.js';
export const retentionKey=(scope:WorkspaceScope)=>[...queryKeys.workspace(scope.organizationId,scope.workspaceId),'retention'] as const;
export const retentionParams=(scope:WorkspaceScope)=>({organizationId:scope.organizationId,workspaceId:scope.workspaceId});

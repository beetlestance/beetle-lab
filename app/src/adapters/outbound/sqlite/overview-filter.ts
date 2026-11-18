import type { OrganizationScope, WorkspaceScope } from '@beetle/contracts/api';
const workspace = 'organization_id=? AND workspace_id=?';
const organization =
  'organization_id=? AND workspace_id IN (SELECT id FROM workspaces INDEXED BY workspaces_visible WHERE retired=0 AND organization_id=?)';
const historicalOrganization = 'organization_id=?';
/** SQL fragments are selected internally, never supplied by an API request. */
export function overviewFilter(scope: WorkspaceScope | OrganizationScope, historical: boolean) {
  if (scope.kind === 'workspace') return { where: workspace, args: [scope.organizationId, scope.workspaceId] } as const;
  if (historical) return { where: historicalOrganization, args: [scope.organizationId] } as const;
  return { where: organization, args: [scope.organizationId, scope.organizationId] } as const;
}
export type OverviewFilter = ReturnType<typeof overviewFilter>;

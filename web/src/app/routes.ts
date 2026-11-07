import { validateApi } from '@beetle/contracts/api';

export const routes = {
  organizations: '/',
  organizationPattern: '/organizations/:organizationId',
  workspacePattern: '/organizations/:organizationId/workspaces/:workspaceId',
  organization: (organizationId: string) => `/organizations/${encodeURIComponent(organizationId)}`,
  workspace: (organizationId: string, workspaceId: string) =>
    `/organizations/${encodeURIComponent(organizationId)}/workspaces/${encodeURIComponent(workspaceId)}`,
};

export function validId(value: string | undefined): value is string {
  return validateApi('Uuid', value).ok;
}

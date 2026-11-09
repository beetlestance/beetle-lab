import { validateApi } from '@beetle/contracts/api';

export const routes = {
  inputsPattern: '/organizations/:organizationId/workspaces/:workspaceId/inputs',
  inputs: (org: string, workspace: string) => `/organizations/${encodeURIComponent(org)}/workspaces/${encodeURIComponent(workspace)}/inputs`,
  suitesPattern: '/organizations/:organizationId/workspaces/:workspaceId/suites',
  suitePattern: '/organizations/:organizationId/workspaces/:workspaceId/suites/:suiteId',
  suites: (org: string, workspace: string) => `/organizations/${encodeURIComponent(org)}/workspaces/${encodeURIComponent(workspace)}/suites`,
  suite: (org: string, workspace: string, id: string) => `/organizations/${encodeURIComponent(org)}/workspaces/${encodeURIComponent(workspace)}/suites/${encodeURIComponent(id)}`,
  organizations: '/',
  settings: '/settings',
  organizationSettingsPattern: '/organizations/:organizationId/settings',
  workspaceSettingsPattern: '/organizations/:organizationId/workspaces/:workspaceId/settings',
  organizationSettings: (id: string) => `/organizations/${encodeURIComponent(id)}/settings`,
  workspaceSettings: (org: string, id: string) => `/organizations/${encodeURIComponent(org)}/workspaces/${encodeURIComponent(id)}/settings`,
  organizationPattern: '/organizations/:organizationId',
  workspacePattern: '/organizations/:organizationId/workspaces/:workspaceId',
  organization: (organizationId: string) => `/organizations/${encodeURIComponent(organizationId)}`,
  workspace: (organizationId: string, workspaceId: string) =>
    `/organizations/${encodeURIComponent(organizationId)}/workspaces/${encodeURIComponent(workspaceId)}`,
};

export function validId(value: string | undefined): value is string {
  return validateApi('Uuid', value).ok;
}

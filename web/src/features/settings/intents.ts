import type { ApiClient, ApiClientResult, InstallationPatch, InstallationSettings, OrganizationSettings,
  ScopedOverridePatch, SettingsScope, WorkspaceSettings } from '@beetle/contracts/api';
import { validateApi } from '@beetle/contracts/api';
import type { EditorField, EditorIntent } from '../../components/Editor.js';

export type SettingsData = InstallationSettings | OrganizationSettings | WorkspaceSettings;
export function settingsRead(api: ApiClient, scope: SettingsScope, signal: AbortSignal): Promise<ApiClientResult<SettingsData>> {
  if (scope.kind === 'installation') return api.getInstallationSettings({ signal });
  const params = { organizationId: scope.organizationId };
  return scope.kind === 'organization' ? api.getOrganizationSettings({ params, signal })
    : api.getWorkspaceSettings({ params: { ...params, workspaceId: scope.workspaceId }, signal });
}
function write(api: ApiClient, data: SettingsData, patch: InstallationPatch | ScopedOverridePatch, requestId: string): Promise<ApiClientResult<unknown>> {
  const base = { requestId, expectedVersion: data.version, schemaVersion: 2 as const };
  if (data.scope.kind === 'installation') {
    const body = { ...base, scope: data.scope, patch: patch as InstallationPatch };
    if (!validateApi('PatchInstallationSettingsRequest', body).ok) return Promise.resolve({ ok: false, error: { kind: 'request' } });
    return api.patchInstallationSettings({ body });
  }
  const body = { ...base, scope: data.scope, patch: patch as ScopedOverridePatch };
  if (data.scope.kind === 'organization') return api.patchOrganizationSettings({ params: { organizationId: data.scope.organizationId },
    body: { ...body, scope: data.scope } });
  return api.patchWorkspaceSettings({ params: { organizationId: data.scope.organizationId, workspaceId: data.scope.workspaceId },
    body: { ...body, scope: data.scope } });
}
export function settingsIntent(input: { api: ApiClient; data: SettingsData; path: string; title: string; fields: EditorField[];
  parse: (values: Readonly<Record<string, string>>) => InstallationPatch | ScopedOverridePatch; refresh: () => Promise<unknown> }): EditorIntent {
  return { title: input.title, path: input.path, fields: input.fields, refresh: input.refresh,
    submit: (values, requestId) => {
      try { return write(input.api, input.data, input.parse(values), requestId); }
      catch { return Promise.resolve({ ok: false, error: { kind: 'request' } }); }
    } };
}

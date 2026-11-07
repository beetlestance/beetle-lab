import type { InstallationSettings, OrganizationSettings, WorkspaceSettings, SettingsScope } from '@beetle/contracts/api';

export type SettingsView = InstallationSettings | OrganizationSettings | WorkspaceSettings;
export interface SettingsIdentity { id: string; scope: SettingsScope }

/** Bounded scoped effects. Identity reads must never resolve defaults or runtime. */
export interface SettingsReader {
  getSettings(scope: SettingsScope): Promise<SettingsView>;
  getSettingsIdentity(scope: SettingsScope): Promise<SettingsIdentity>;
}

import type {
  InstallationSettings, OrganizationSettings, PatchInstallationSettingsRequest,
  PatchOrganizationSettingsRequest, PatchWorkspaceSettingsRequest, WorkspaceSettings,
} from '@beetle/contracts/api';
import type { RuntimeCeilings } from './validation.js';
import type { SettingsChain } from './resolve.js';

export type SettingsRequest = PatchInstallationSettingsRequest |
  PatchOrganizationSettingsRequest | PatchWorkspaceSettingsRequest;
export interface SettingsCommand {
  kind: 'patchSettings';
  id: string;
  request: SettingsRequest;
  intentDigest: string;
}
export interface SettingsEvidence {
  chain: SettingsChain;
  /** Caller-reported capacity snapshot, obtained without I/O in the transaction. */
  runtime: RuntimeCeilings | null;
}
export interface SettingsChange {
  settings: InstallationSettings | OrganizationSettings | WorkspaceSettings;
  /** Signal only. Admission owns drain/new-work blocking; no active work is killed. */
  admission: 'drain' | 'unchanged';
}

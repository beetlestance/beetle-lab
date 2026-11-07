import type { ApiOperation } from '../generated/operations.js';
import type { EffectiveSettings, SettingsScope } from '../generated/types.js';
import type { PreparedInput } from './input.js';

/** True when child is at parent or below it; settings sources use the reverse direction. */
function contains(parent: SettingsScope, child: SettingsScope): boolean {
  if (parent.kind === 'installation') return true;
  if (child.kind === 'installation' || parent.organizationId !== child.organizationId) return false;
  return parent.kind === 'organization' || (child.kind === 'workspace' && parent.workspaceId === child.workspaceId);
}
function equal(left: SettingsScope, right: SettingsScope): boolean {
  return left.kind === right.kind && contains(left, right);
}
function routeOwner(input: PreparedInput): SettingsScope {
  const { organizationId, workspaceId } = input.params;
  if (!organizationId) return { kind: 'installation' };
  return workspaceId ? { kind: 'workspace', organizationId, workspaceId } : { kind: 'organization', organizationId };
}
function retention(operation: ApiOperation): boolean {
  return 'request' in operation && ['RetentionPreviewRequest', 'RetentionApplyRequest'].includes(operation.request);
}

export function requestOwnership(operation: ApiOperation, input: PreparedInput): boolean {
  if (!input.body) return true;
  const scope = input.body.scope as SettingsScope;
  const route = routeOwner(input);
  if (retention(operation)) return route.kind === 'installation' ? scope.kind === 'installation' : contains(route, scope);
  // Organisations themselves are installation-owned; their UUID lives in the route.
  if (operation.path === '/api/v2/organizations/{organizationId}') return scope.kind === 'installation';
  if ('request' in operation && ['PatchWorkspaceRequest', 'DeleteWorkspaceRequest'].includes(operation.request)) {
    return equal({ kind: 'organization', organizationId: input.params.organizationId! }, scope);
  }
  if ('params' in operation && operation.params === 'FolderParams') return contains(route, scope);
  return equal(route, scope);
}

interface OwnedReply {
  scope: SettingsScope;
  id?: string;
  requestId?: string;
  settingsId?: string;
  settingsVersion?: number;
  snapshotId?: string;
  snapshotVersion?: number;
  items?: { scope: SettingsScope }[];
  candidates?: { scope: SettingsScope }[];
  effective?: EffectiveSettings;
}
function expectedOwner(operation: ApiOperation, input: PreparedInput): SettingsScope {
  if (input.body) return input.body.scope as SettingsScope;
  if (operation.response === 'Organization') return { kind: 'installation' };
  if (operation.response === 'Workspace') return { kind: 'organization', organizationId: input.params.organizationId! };
  return routeOwner(input);
}
function identityMatches(operation: ApiOperation, input: PreparedInput, reply: OwnedReply): boolean {
  const params = input.params;
  const identities: Partial<Record<ApiOperation['response'], string | undefined>> = {
    Organization: params.organizationId, Workspace: params.workspaceId, Folder: params.id,
  };
  if (operation.response === 'DeletionReceipt') {
    return reply.id === (params.id ?? params.workspaceId ?? params.organizationId) && reply.requestId === input.body?.requestId;
  }
  const expected = identities[operation.response];
  return expected === undefined || reply.id === expected;
}
function retentionMatches(input: PreparedInput, reply: OwnedReply): boolean {
  const body = input.body!;
  if (reply.requestId !== body.requestId || reply.settingsId !== body.settingsId || reply.settingsVersion !== body.expectedVersion) return false;
  if ('snapshotId' in body && (reply.snapshotId !== body.snapshotId || reply.snapshotVersion !== body.snapshotVersion)) return false;
  return (reply.candidates ?? []).every(candidate => contains(reply.scope, candidate.scope));
}
function sourceAncestry(scope: SettingsScope, effective: EffectiveSettings): boolean {
  const leaves = [effective.runDefaults.engineProfile, effective.retention, ...Object.values(effective.runDefaults.budget)];
  return leaves.every(leaf => contains(leaf.source, scope));
}

/** Structural validation precedes this route/body/result binding. Backend SQL authorization is independent. */
export function responseOwnership(operation: ApiOperation, input: PreparedInput, value: unknown): boolean {
  const reply = value as OwnedReply;
  if (!equal(expectedOwner(operation, input), reply.scope) || !identityMatches(operation, input, reply)) return false;
  if (reply.items && !reply.items.every(item => equal(reply.scope, item.scope))) return false;
  if (retention(operation) && !retentionMatches(input, reply)) return false;
  return !reply.effective || sourceAncestry(reply.scope, reply.effective);
}

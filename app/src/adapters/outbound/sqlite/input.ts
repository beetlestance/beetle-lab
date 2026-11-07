import { createHash } from 'node:crypto';
import { encodeJson, validatePrimitive } from '@beetle/contracts';
import { validateApi } from '@beetle/contracts/api';
import type { SettingsScope } from '@beetle/contracts/api';
import { prepareNamespaceCommand } from '../../../application/namespaces/index.js';
import { prepareSettingsCommand } from '../../../application/settings/index.js';
import { requireRule } from '../../../domain/namespaces/index.js';
import { StorageError } from './protocol.js';
import type { Bootstrap, EntityKey, ListQuery, Operation, RuntimeObservation } from './protocol.js';

export const MAX_MESSAGE_BYTES = 65536;
export const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex');
export const lower = (id: string): string => id.toLowerCase();
export const scopeKey = (scope: SettingsScope): string => {
  if (scope.kind === 'installation') return 'installation';
  if (scope.kind === 'organization') return `organization:${lower(scope.organizationId)}`;
  return `workspace:${lower(scope.organizationId)}:${lower(scope.workspaceId)}`;
};
export function uuid(value: string): void {
  if (!validatePrimitive('uuid', value).ok) throw new StorageError('invalid_input');
}
export function boundedCopy<T>(input: T, limit = MAX_MESSAGE_BYTES): T {
  try { return JSON.parse(encodeJson(input, limit)) as T; }
  catch { throw new StorageError('invalid_input'); }
}
export function checkedScope(scope: SettingsScope): void {
  requireRule(validateApi('SettingsScope', scope).ok);
}
function checkedObservationTime(observation: RuntimeObservation, ttl: number): void {
  const now = Date.now();
  requireRule(observation !== undefined && Number.isSafeInteger(observation.observedAtMs) &&
    observation.observedAtMs >= 0 && observation.observedAtMs <= now && now - observation.observedAtMs <= ttl);
}
export function checkedRuntime(observation: RuntimeObservation | null, ttl = 5000): void {
  if (observation === null) return;
  checkedObservationTime(observation, ttl);
  const runtime = observation.ceilings;
  requireRule(runtime !== undefined && validateApi('PoolCapacity', runtime.pool).ok && validateApi('Budget', runtime.perRun).ok);
  requireRule(Array.isArray(runtime.supportedProfiles) && runtime.supportedProfiles.length >= 1 &&
    runtime.supportedProfiles.length <= 32 && new Set(runtime.supportedProfiles).size === runtime.supportedProfiles.length);
  runtime.supportedProfiles.forEach(profile => requireRule(validateApi('EngineProfile', profile).ok));
}
export function checkedBootstrap(input: Bootstrap): Bootstrap {
  const copy = boundedCopy(input);
  const record = copy.installation;
  uuid(record.id); requireRule(record.version === 1 && record.schemaVersion === 2);
  requireRule(validateApi('InstallationScope', record.scope).ok && validateApi('InstallationValues', record.values).ok);
  const ttl = copy.runtimeTtlMs ?? 5000;
  requireRule(Number.isSafeInteger(ttl) && ttl >= 1 && ttl <= 60000);
  checkedRuntime(copy.runtime, ttl);
  return copy;
}
function checkedKey(key: EntityKey): void {
  checkedScope(key.scope); uuid(key.id);
  const expected = { organization: 'installation', workspace: 'organization', folder: 'workspace' };
  requireRule(expected[key.kind] === key.scope.kind);
}
function checkedList(query: ListQuery): void {
  checkedKey({ ...query, id: '00000000-0000-4000-8000-000000000000' });
  requireRule(Number.isSafeInteger(query.limit) && query.limit >= 1 && query.limit <= 100);
  if (query.kind === 'folder') { if (query.parentFolderId !== undefined) uuid(query.parentFolderId); }
  else requireRule(query.parentFolderId === undefined);
  if (query.cursor !== undefined) requireRule(typeof query.cursor === 'string' && query.cursor.length <= 1024);
}
function checkedNamespace(operation: Extract<Operation, { kind: 'namespace' }>): void {
  const command = operation.command;
  const names = { createOrganization: 'CreateOrganizationRequest', patchOrganization: 'PatchOrganizationRequest',
    createWorkspace: 'CreateWorkspaceRequest', patchWorkspace: 'PatchWorkspaceRequest',
    createFolder: 'CreateFolderRequest', patchFolder: 'PatchFolderRequest' } as const;
  requireRule(Object.hasOwn(names, command.kind) && validateApi(names[command.kind], command.request).ok);
  uuid(command.id); if (command.kind === 'createWorkspace') uuid(command.rootFolderId);
  requireRule(prepareNamespaceCommand(command, sha256).intentDigest === command.intentDigest);
}
function checkedSettings(operation: Extract<Operation, { kind: 'settings' }>): void {
  const command = operation.command;
  uuid(command.id); requireRule(command.kind === 'patchSettings'); checkedScope(command.request.scope);
  const names = { installation: 'PatchInstallationSettingsRequest', organization: 'PatchOrganizationSettingsRequest',
    workspace: 'PatchWorkspaceSettingsRequest' } as const;
  requireRule(validateApi(names[command.request.scope.kind], command.request).ok);
  requireRule(prepareSettingsCommand({ ...command, digest: sha256 }).intentDigest === command.intentDigest);
}
export function checkedOperation(input: Operation, runtimeTtlMs = 5000): Operation {
  const operation = boundedCopy(input);
  switch (operation.kind) {
    case 'namespace': checkedNamespace(operation); break;
    case 'settings': checkedSettings(operation); break;
    case 'get': checkedKey(operation.key); break;
    case 'list': checkedList(operation.query); break;
    case 'getSettings': checkedScope(operation.scope); break;
    case 'runtime': checkedRuntime(operation.runtime, runtimeTtlMs); break;
    case 'close': break;
    default: throw new StorageError('invalid_input');
  }
  return operation;
}

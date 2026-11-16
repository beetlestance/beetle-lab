import { validateApi } from '@beetle/contracts/api';
import type { InputControl, InputCommand, InputKey, InputList, InputRecoveryPage, InputAdvance } from '../../../ports/inputs.js';
import { INPUT_MAXIMUM_BYTES } from '../../../ports/inputs.js';
import { digestMutationIntent } from '../../../application/namespaces/index.js';
import { normalizedName, requireRule } from '../../../domain/namespaces/index.js';
import { lower, sha256, uuid } from './input-values.js';
import type { Operation } from './protocol.js';

export function inputIntentDigest(command: InputControl): string {
  const intent = command.kind === 'createInput' ? { kind: command.kind, request: command.request } :
    { kind: command.kind, id: command.id, request: command.request };
  return digestMutationIntent(intent, sha256);
}
function fields(value: object, allowed: readonly string[]): void {
  requireRule(Object.keys(value).every(key => allowed.includes(key)));
}
export function checkedInputKey(key: InputKey): void {
  fields(key, ['scope', 'id']); uuid(key.id); requireRule(validateApi('WorkspaceScope', key.scope).ok);
}
function version(value: number): void { requireRule(Number.isSafeInteger(value) && value >= 1); }
function control(command: InputCommand): void {
  fields(command, ['kind', 'id', 'request', 'intentDigest']);
  uuid(command.id); uuid(command.request.requestId);
  requireRule(validateApi('WorkspaceScope', command.request.scope).ok);
  if (command.kind === 'createInput') {
    fields(command.request, ['scope', 'requestId', 'name', 'folderId', 'sha256', 'bytes']);
    requireRule(typeof command.request.name === 'string'); normalizedName(command.request.name);
    if (command.request.folderId !== undefined) uuid(command.request.folderId);
    requireRule(typeof command.request.sha256 === 'string' && /^[a-f0-9]{64}$/.test(command.request.sha256));
    requireRule(Number.isSafeInteger(command.request.bytes) && command.request.bytes >= 0 && command.request.bytes <= INPUT_MAXIMUM_BYTES);
  } else {
    requireRule(command.kind === 'sealInput' || command.kind === 'deleteInput');
    fields(command.request, ['scope', 'requestId', 'expectedVersion']); version(command.request.expectedVersion);
  }
  requireRule(inputIntentDigest(command) === command.intentDigest);
}
function page(query: InputList | InputRecoveryPage): void {
  requireRule(Number.isSafeInteger(query.limit) && query.limit >= 1 && query.limit <= 100);
  if (query.cursor !== undefined) requireRule(typeof query.cursor === 'string' && query.cursor.length <= 1024);
  if ('scope' in query) {
    fields(query, ['scope', 'limit', 'cursor']); requireRule(validateApi('WorkspaceScope', query.scope).ok);
  } else {
    fields(query, ['limit', 'cursor', 'mode']);
    requireRule(query.mode === undefined || query.mode === 'pending');
  }
}
function advance(command: InputAdvance): void {
  checkedInputKey(command.key); version(command.expectedVersion);
  if (command.kind === 'commitInputOffset') {
    fields(command, ['kind', 'key', 'expectedVersion', 'offset']);
    requireRule(Number.isSafeInteger(command.offset) && command.offset >= 1 && command.offset <= INPUT_MAXIMUM_BYTES);
  } else if (command.kind === 'failInput') {
    fields(command, ['kind', 'key', 'expectedVersion', 'reason']);
    requireRule(['custody_missing', 'integrity', 'io', 'unverified_legacy'].includes(command.reason));
  } else {
    fields(command, ['kind', 'key', 'expectedVersion']);
    requireRule(command.kind === 'publishInput' || command.kind === 'deleteInputBytes');
  }
}
export function checkedInputOperation(operation: Operation): boolean {
  switch (operation.kind) {
    case 'input': control(operation.command); return true;
    case 'advanceInput': advance(operation.command); return true;
    case 'getInput': checkedInputKey(operation.key); return true;
    case 'listInputs': page(operation.query); requireRule('scope' in operation.query); return true;
    case 'recoverInputs': fields(operation.query, ['limit', 'cursor', 'mode']); page(operation.query); return true;
    case 'inputStorage': return true;
    default: return false;
  }
}
export const canonicalInputKey = (key: InputKey): InputKey => ({ id: lower(key.id), scope: { kind: 'workspace',
  organizationId: lower(key.scope.organizationId), workspaceId: lower(key.scope.workspaceId) } });

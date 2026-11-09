import { encodeJson, validatePrimitive } from '@beetle/contracts';
import { validateApi } from '@beetle/contracts/api';
import { immutableSnapshot, normalizedName, requireRule, sameScope, sameUuid } from '../../domain/namespaces/index.js';
import { digestMutationIntent } from '../namespaces/index.js';
import type { IntentDigest } from '../namespaces/index.js';
import type { InputCommand, InputControl, InputKey, InputList, InputPage, InputRecord, InputRecoveryPage } from '../../ports/inputs.js';
import { INPUT_MAXIMUM_BYTES } from '../../ports/inputs.js';
import type { InputContentRange } from '../../ports/input-bytes.js';
import type { InputOperationContext } from '../../ports/input-service.js';

export function snapshot<T>(value: T): T {
  return immutableSnapshot(JSON.parse(encodeJson(value, 65536)) as T);
}
/** 100 canonical rows (<=1197 JSON bytes each), escaped 1024-character cursor and envelope fit 128KiB. */
export function inputPageSnapshot(value: InputPage): InputPage {
  return immutableSnapshot(JSON.parse(encodeJson(value, 131072)) as InputPage);
}
function fields(value: object, allowed: readonly string[]): void {
  requireRule(Object.keys(value).every(key => allowed.includes(key)));
}
function uuid(value: string): string {
  requireRule(validatePrimitive('uuid', value).ok); return value.toLowerCase();
}
export function keySnapshot(value: InputKey): InputKey {
  const key = snapshot(value); fields(key, ['scope', 'id']);
  requireRule(validateApi('WorkspaceScope', key.scope).ok);
  return immutableSnapshot({ id: uuid(key.id), scope: { kind: 'workspace',
    organizationId: uuid(key.scope.organizationId), workspaceId: uuid(key.scope.workspaceId) } });
}
export function commandSnapshot(value: InputControl, digest: IntentDigest): InputCommand {
  const copy = snapshot(value); fields(copy, ['kind', 'id', 'request']);
  const key = keySnapshot({ id: copy.id, scope: copy.request.scope });
  const request = { ...copy.request, scope: key.scope, requestId: uuid(copy.request.requestId) };
  if (copy.kind === 'createInput' && 'name' in request) {
    fields(request, ['scope', 'requestId', 'name', 'folderId', 'sha256', 'bytes']);
    requireRule(typeof request.name === 'string');
    requireRule(/^[a-f0-9]{64}$/.test(request.sha256));
    requireRule(Number.isSafeInteger(request.bytes) && request.bytes >= 0 && request.bytes <= INPUT_MAXIMUM_BYTES);
    const creation = { ...request, name: normalizedName(request.name),
      ...(request.folderId === undefined ? {} : { folderId: uuid(request.folderId) }) };
    return snapshot({ kind: 'createInput', id: key.id, request: creation,
      intentDigest: digestMutationIntent({ kind: 'createInput', request: creation }, digest) });
  }
  requireRule(copy.kind === 'sealInput' || copy.kind === 'deleteInput');
  fields(request, ['scope', 'requestId', 'expectedVersion']);
  requireRule('expectedVersion' in request && Number.isSafeInteger(request.expectedVersion) && request.expectedVersion >= 1);
  const transition = { kind: copy.kind, id: key.id, request } as Extract<InputControl, { kind: 'sealInput' | 'deleteInput' }>;
  return snapshot({ ...transition, intentDigest: digestMutationIntent(transition, digest) });
}
export function pageSnapshot<T extends InputList | InputRecoveryPage>(value: T, scoped: boolean): T {
  const copy = snapshot(value);
  requireRule(('scope' in copy) === scoped);
  fields(copy, scoped ? ['scope', 'limit', 'cursor'] : ['limit', 'cursor']);
  requireRule(Number.isSafeInteger(copy.limit) && copy.limit >= 1 && copy.limit <= 100);
  requireRule(copy.cursor === undefined || (typeof copy.cursor === 'string' && copy.cursor.length <= 1024));
  if ('scope' in copy) return snapshot({ ...copy, scope: keySnapshot({ scope: copy.scope, id: '00000000-0000-4000-8000-000000000000' }).scope });
  return copy;
}
export function checkedRecord(value: InputRecord, key?: InputKey): InputRecord {
  const copy = snapshot(value);
  fields(copy, ['id', 'scope', 'name', 'folderId', 'sha256', 'bytes', 'offset', 'version', 'state', 'reason']);
  const identity = keySnapshot({ id: copy.id, scope: copy.scope });
  uuid(copy.folderId); normalizedName(copy.name);
  requireRule(/^[a-f0-9]{64}$/.test(copy.sha256));
  requireRule(Number.isSafeInteger(copy.bytes) && copy.bytes >= 0 && copy.bytes <= INPUT_MAXIMUM_BYTES);
  requireRule(Number.isSafeInteger(copy.offset) && copy.offset >= 0 && copy.offset <= copy.bytes);
  requireRule(Number.isSafeInteger(copy.version) && copy.version >= 1);
  requireRule(['staging', 'publishing', 'published', 'deleting', 'deleted', 'failed'].includes(copy.state));
  requireRule(copy.reason === null || ['custody_missing', 'integrity', 'io', 'unverified_legacy'].includes(copy.reason));
  requireRule(!['published', 'publishing'].includes(copy.state) || copy.offset === copy.bytes);
  if (key) requireRule(sameUuid(identity.id, key.id) && sameScope(identity.scope, key.scope), 'not_found');
  return snapshot({ ...copy, ...identity });
}
export function rangeSnapshot(value: InputContentRange | undefined): InputContentRange | undefined {
  if (value === undefined) return undefined;
  const copy = snapshot(value); fields(copy, ['start', 'endExclusive']);
  requireRule(Number.isSafeInteger(copy.start) && copy.start >= 0);
  requireRule(Number.isSafeInteger(copy.endExclusive) && copy.endExclusive >= copy.start && copy.endExclusive <= INPUT_MAXIMUM_BYTES);
  return copy;
}

export function capturedSignal(context: InputOperationContext | undefined): AbortSignal | undefined {
  if (context === undefined) return undefined;
  requireRule(context !== null && typeof context === 'object');
  fields(context, ['signal']);
  const signal = context.signal;
  requireRule(signal === undefined || signal instanceof AbortSignal);
  return signal;
}

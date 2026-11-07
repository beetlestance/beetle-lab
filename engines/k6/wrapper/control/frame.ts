import { encodeJson, validate, validatePrimitive } from '@beetle/contracts';
import type { ControlEvent } from '@beetle/contracts';
import { JournalError } from './errors.js';

export const FRAME_BYTES = 65_536;
export const FILE_BYTES = 67_108_864;
export const RECORDS = 65_536;
export interface JournalScope {
  readonly organizationId: string;
  readonly workspaceId: string;
  readonly attemptId: string;
  readonly generation: number;
}
export type ControlDraft = ControlEvent extends infer E ? E extends ControlEvent ? Omit<E, 'seq'> : never : never;

export function scopeSnapshot(input: JournalScope): Readonly<JournalScope> {
  let snapshot: JournalScope;
  try { snapshot = JSON.parse(encodeJson(input, 1024)) as JournalScope; }
  catch { throw new JournalError('invalid_options'); }
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) throw new JournalError('invalid_options');
  const ids = [snapshot.organizationId, snapshot.workspaceId, snapshot.attemptId];
  if (ids.some(id => !validatePrimitive('uuid', id).ok) ||
      !Number.isSafeInteger(snapshot.generation) || snapshot.generation < 1 ||
      Object.keys(snapshot).length !== 4) throw new JournalError('invalid_options');
  return Object.freeze(snapshot);
}

export function assertScope(event: JournalScope, scope: JournalScope): void {
  if (event.organizationId !== scope.organizationId || event.workspaceId !== scope.workspaceId ||
      event.attemptId !== scope.attemptId || event.generation !== scope.generation) {
    throw new JournalError('scope_mismatch');
  }
}

function freeze(value: unknown): void {
  if (value === null || typeof value !== 'object') return;
  for (const child of Object.values(value)) freeze(child);
  Object.freeze(value);
}

export function validateEvent(input: unknown, scope: JournalScope): ControlEvent {
  const checked = validate('ControlEvent', input);
  if (!checked.ok) throw new JournalError('invalid_event');
  assertScope(checked.value, scope);
  if (checked.value.kind === 'engine.result') assertScope(checked.value.payload, scope);
  freeze(checked.value);
  return checked.value;
}

export function frame(draft: unknown, seq: number, scope: JournalScope): { event: ControlEvent; bytes: Buffer } {
  let snapshot: Record<string, unknown>;
  try { snapshot = JSON.parse(encodeJson(draft, FRAME_BYTES - 1)) as Record<string, unknown>; }
  catch { throw new JournalError('frame_limit'); }
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot) || Object.hasOwn(snapshot, 'seq')) {
    throw new JournalError('invalid_event');
  }
  snapshot.seq = seq;
  const event = validateEvent(snapshot, scope);
  let json: string;
  try { json = encodeJson(event, FRAME_BYTES - 1); }
  catch { throw new JournalError('frame_limit'); }
  return { event, bytes: Buffer.from(json + '\n', 'utf8') };
}

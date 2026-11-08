import { encodeJson, validate, validatePrimitive } from '@beetle/contracts';
import type { ControlEvent } from '@beetle/contracts';
import { CONTROL_BATCH_BYTES, CONTROL_BATCH_EVENTS, CONTROL_FRAME_BYTES, CONTROL_FILE_BYTES, CONTROL_RECORDS } from './types.js';
import type { ControlScope, WrapperBatch, WrapperCheckpoint, WrapperCursor } from './types.js';

export class ControlProtocolError extends Error { constructor() { super('Invalid control protocol input'); } }
function record(input: unknown, cap: number, keys: string): Record<string, unknown> {
  const value: unknown = JSON.parse(encodeJson(input, cap));
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).sort().join(',') !== keys) throw new ControlProtocolError();
  return value as Record<string, unknown>;
}
function integer(value: unknown, minimum: number, maximum: number): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= minimum && value <= maximum;
}
function identity(value: unknown): value is string {
  return typeof value === 'string' && /^(0|[1-9][0-9]{0,19})$/.test(value) && BigInt(value) <= 18_446_744_073_709_551_615n;
}
function digest(value: unknown): value is string { return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value); }
function cursor(value: Record<string, unknown>): WrapperCursor {
  if (value.version !== 1 || !identity(value.dev) || !identity(value.ino)
    || !integer(value.offset, 0, CONTROL_FILE_BYTES) || !integer(value.wrapperSeq, 0, CONTROL_RECORDS)
    || !digest(value.prefixSha256)) throw new ControlProtocolError();
  if ((value.offset === 0) !== (value.wrapperSeq === 0) || value.offset < value.wrapperSeq) throw new ControlProtocolError();
  return Object.freeze({ version: 1, dev: value.dev, ino: value.ino, offset: value.offset,
    wrapperSeq: value.wrapperSeq, prefixSha256: value.prefixSha256 });
}
export function copyControlScope(input: unknown): Readonly<ControlScope> {
  const value = record(input, 640, 'attemptId,generation,organizationId,workspaceId');
  for (const key of ['attemptId', 'organizationId', 'workspaceId']) {
    if (!validatePrimitive('uuid', value[key]).ok) throw new ControlProtocolError();
  }
  if (!integer(value.generation, 1, Number.MAX_SAFE_INTEGER)) throw new ControlProtocolError();
  return Object.freeze({ attemptId: value.attemptId as string, organizationId: value.organizationId as string,
    workspaceId: value.workspaceId as string, generation: value.generation });
}
export function copyWrapperCursor(input: unknown): Readonly<WrapperCursor> {
  return cursor(record(input, 1024, 'dev,ino,offset,prefixSha256,version,wrapperSeq'));
}
export function copyWrapperCheckpoint(input: unknown): Readonly<WrapperCheckpoint> {
  const value = record(input, 1024, 'dev,ino,lastBatchDigest,offset,prefixSha256,version,wrapperSeq');
  if (!digest(value.lastBatchDigest)) throw new ControlProtocolError();
  return Object.freeze({ ...cursor(value), lastBatchDigest: value.lastBatchDigest });
}
function freeze(value: unknown): void {
  if (value === null || typeof value !== 'object') return;
  for (const child of Object.values(value)) freeze(child);
  Object.freeze(value);
}
function assertScope(value: ControlScope, key: Readonly<ControlScope>): void {
  for (const field of ['attemptId', 'organizationId', 'workspaceId', 'generation'] as const) {
    if (value[field] !== key[field]) throw new ControlProtocolError();
  }
}
function eventsCopy(input: unknown, key: Readonly<ControlScope>, after: number): readonly ControlEvent[] {
  if (!Array.isArray(input) || input.length < 1 || input.length > CONTROL_BATCH_EVENTS) throw new ControlProtocolError();
  const events: ControlEvent[] = [];
  for (const value of input) {
    const checked = validate('ControlEvent', value); if (!checked.ok) throw new ControlProtocolError();
    const event = checked.value;
    encodeJson(event, CONTROL_FRAME_BYTES - 1);
    assertScope(event, key);
    if (event.kind === 'engine.result') assertScope(event.payload, key);
    if (event.seq !== after + events.length + 1) throw new ControlProtocolError();
    freeze(event); events.push(event);
  }
  return Object.freeze(events);
}
function transition(expected: Readonly<WrapperCheckpoint> | null, next: Readonly<WrapperCursor>, count: number): void {
  const before = expected ?? { offset: 0, wrapperSeq: 0, dev: next.dev, ino: next.ino };
  if (next.wrapperSeq !== before.wrapperSeq + count || next.offset <= before.offset) throw new ControlProtocolError();
  if (next.dev !== before.dev || next.ino !== before.ino) throw new ControlProtocolError();
}
/** Defensive JSON snapshot: no getters, unknown fields, shared caller objects or oversized worker messages. */
export function copyWrapperBatch(input: unknown): Readonly<WrapperBatch> {
  const value = record(input, CONTROL_BATCH_BYTES, 'events,expected,key,next');
  const key = copyControlScope(value.key);
  const expected = value.expected === null ? null : copyWrapperCheckpoint(value.expected);
  const next = copyWrapperCursor(value.next);
  const events = eventsCopy(value.events, key, expected?.wrapperSeq ?? 0);
  transition(expected, next, events.length);
  return Object.freeze({ key, expected, next, events });
}

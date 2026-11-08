import { CONTROL_FRAME_BYTES } from '../control-protocol/index.js';
import { encodeJson, validate } from '@beetle/contracts';
import type { Ack, ControlEvent } from '@beetle/contracts';
import { attemptKey, canonical } from './input.js';
import type { EventInput, GenerationKey } from './protocol.js';

export const MAX_SUPERVISOR_INPUT_BYTES = 65_536;
export const MAX_BATCH_BYTES = 262_144;
export const DEFAULT_QUOTA_BYTES = 67_108_864;
export function eventKey(input: GenerationKey): GenerationKey {
  return { attemptId: input.attemptId, organizationId: input.organizationId,
    workspaceId: input.workspaceId, generation: input.generation };
}
export function generationKey(input: GenerationKey): GenerationKey {
  const copy = JSON.parse(encodeJson(input, 640)) as GenerationKey;
  if (!Number.isSafeInteger(copy.generation) || copy.generation < 1) throw new Error('invalid_input');
  return { ...attemptKey(copy), generation: copy.generation };
}
function sourceOrdinal(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) throw new Error('invalid_input');
  return value;
}
function supervisorDraft(copy: unknown): { event: Record<string, unknown>; ordinal: number } {
  if (!copy || typeof copy !== 'object' || Array.isArray(copy)) throw new Error('invalid_input');
  const value = copy as Record<string, unknown>;
  if (Object.keys(value).sort().join(',') !== 'event,sourceOrdinal') throw new Error('invalid_input');
  const ordinal = sourceOrdinal(value.sourceOrdinal);
  const event = value.event;
  if (!event || typeof event !== 'object') throw new Error('invalid_input');
  if (Array.isArray(event) || 'seq' in event) throw new Error('invalid_input');
  return { event: event as Record<string, unknown>, ordinal };
}
export function eventInput(input: unknown, source: 'wrapper' | 'agent'): EventInput {
  const copy: unknown = JSON.parse(encodeJson(input, source === 'wrapper' ? CONTROL_FRAME_BYTES - 1 : MAX_SUPERVISOR_INPUT_BYTES));
  if (source === 'wrapper') {
    const result = validate('ControlEvent', copy);
    if (!result.ok) throw new Error('invalid_input');
    const event: ControlEvent = result.value;
    return { key: generationKey(eventKey(event)), source, sourceKey: event.seq,
      json: JSON.stringify(event), canonical: canonical(event) };
  }
  const { event, ordinal } = supervisorDraft(copy);
  const result = validate('AgentEvent', { ...event, seq: 1 });
  if (!result.ok || result.value.source !== 'agent') throw new Error('invalid_input');
  return { key: generationKey(eventKey(result.value)), source, sourceKey: ordinal,
    json: JSON.stringify(event), canonical: canonical(copy) };
}
export function ackInput(input: unknown): Ack {
  const copy: unknown = JSON.parse(encodeJson(input, 1024));
  const result = validate('Ack', copy);
  if (!result.ok) throw new Error('invalid_input');
  return result.value;
}
export function cursorInput(input: number): number {
  if (!Number.isSafeInteger(input) || input < 0) throw new Error('invalid_input');
  return input;
}

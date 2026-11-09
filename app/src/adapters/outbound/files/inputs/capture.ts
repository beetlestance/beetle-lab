import type { InputRecord, InputState } from '../../../../ports/inputs.js';
import { INPUT_MAXIMUM_BYTES } from '../../../../ports/inputs.js';
import type { InputContentRange } from '../../../../ports/input-bytes.js';
import { fail } from './job.js';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export interface CapturedInput {
  readonly components: readonly string[];
  readonly sha256: string;
  readonly bytes: number;
  readonly offset: number;
  readonly state: InputState;
}
function boundedInteger(value: number, maximum: number): boolean {
  return Number.isSafeInteger(value) && value >= 0 && value <= maximum;
}
export function capture(record: InputRecord): CapturedInput {
  if (record.scope.kind !== 'workspace') fail('invalid_input');
  const components = [record.scope.organizationId, record.scope.workspaceId, record.id];
  if (!components.every(value => typeof value === 'string' && uuid.test(value))) fail('invalid_input');
  if (typeof record.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(record.sha256)) fail('invalid_input');
  if (!boundedInteger(record.bytes, INPUT_MAXIMUM_BYTES) || !boundedInteger(record.offset, record.bytes)) fail('invalid_input');
  return { components, sha256: record.sha256, bytes: record.bytes, offset: record.offset, state: record.state };
}
export function requireState(input: CapturedInput, state: InputState): void {
  if (input.state !== state) fail('invalid_input');
}
export function captureRange(range: InputContentRange): InputContentRange {
  return { start: range.start, endExclusive: range.endExclusive };
}
export function validateRange(range: InputContentRange, bytes: number): void {
  if (!Number.isSafeInteger(range.start) || !Number.isSafeInteger(range.endExclusive)
    || range.start < 0 || range.endExclusive < range.start || range.endExclusive > bytes) fail('invalid_input');
}

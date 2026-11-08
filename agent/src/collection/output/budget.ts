import { isAbsolute, normalize } from 'node:path';
import { encodeJson } from '@beetle/contracts';
import type { EngineResult } from '@beetle/contracts';
import { copyControlScope, CONTROL_FILE_BYTES } from '../../control-protocol/index.js';
import type { ControlScope } from '../../control-protocol/index.js';
import { OUTPUT_RESULT_BYTES } from './types.js';
import type { OutputCollectionOptions } from './types.js';
import { OutputFailure } from './ports.js';

export interface OutputSnapshot {
  readonly directory: string; readonly uid: number; readonly key: Readonly<ControlScope>;
  readonly engineId: string; readonly reportedResult: Readonly<EngineResult>;
  readonly controlBytes: number; readonly outputBytes: number; readonly deadline: number;
  readonly signal?: AbortSignal;
}
function own(input: OutputCollectionOptions, key: keyof OutputCollectionOptions): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(input, key);
  if (!descriptor) return undefined;
  if (!('value' in descriptor)) throw new OutputFailure('invalid_options');
  return descriptor.value;
}
function integer(value: unknown, minimum: number, maximum: number): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= minimum && value <= maximum;
}
function directoryValue(value: unknown): string {
  if (typeof value !== 'string' || Buffer.byteLength(value) > 4096 || value.includes('\0')
    || !isAbsolute(value) || normalize(value) !== value) throw new OutputFailure('invalid_options');
  return value;
}
function engineValue(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value)) throw new OutputFailure('invalid_options');
  return value;
}
function signalValue(value: unknown): AbortSignal | undefined {
  if (value === undefined || value instanceof AbortSignal) return value;
  throw new OutputFailure('invalid_options');
}
/** Runs synchronously after processwide ownership is reserved; accessors never execute. */
export function snapshotOptions(input: OutputCollectionOptions): OutputSnapshot {
  try {
    const directory = directoryValue(own(input, 'directory')); const uid = own(input, 'uid');
    const key = copyControlScope(own(input, 'key')); const engineId = engineValue(own(input, 'engineId'));
    const reported: unknown = JSON.parse(encodeJson(own(input, 'reportedResult'), OUTPUT_RESULT_BYTES));
    const controlBytes = own(input, 'controlBytes'); const outputBytes = own(input, 'outputBytes');
    const deadline = own(input, 'deadline'); const signal = signalValue(own(input, 'signal'));
    if (!integer(uid, 0, 4_294_967_295) || !integer(controlBytes, 0, CONTROL_FILE_BYTES)
      || !integer(outputBytes, 1, Number.MAX_SAFE_INTEGER)) throw new OutputFailure('invalid_options');
    if (typeof deadline !== 'number' || !Number.isFinite(deadline)) throw new OutputFailure('invalid_options');
    return Object.freeze({ directory, uid, key, engineId, reportedResult: reported as EngineResult,
      controlBytes, outputBytes, deadline, ...(signal === undefined ? {} : { signal }) });
  } catch (error) {
    if (error instanceof OutputFailure) throw error;
    throw new OutputFailure('invalid_options');
  }
}
export function accountedBytes(options: OutputSnapshot, resultBytes: number, artifactBytes: readonly number[]): number {
  let total = BigInt(options.controlBytes) + BigInt(resultBytes);
  for (const bytes of artifactBytes) total += BigInt(bytes);
  if (total > BigInt(options.outputBytes)) throw new OutputFailure('output_limit');
  return Number(total);
}
